import { useCallback, useEffect, useState } from "react";
import { handoffFile, takeHandoff } from "../../lib/handoff";
import { trackEvent } from "../../lib/util";

// ---------------------------------------------------------------------------
// The file a tool is working on.
//
// All four tools had their own copy of this: set busy, clear the error, read the
// file, keep one doc per canvas, remember which tab is showing, and pick up a
// design another tool handed over. The copies had drifted — one reset the tab on
// a new file and one did not, two carried a hand-written duplicate of the same
// error sentence. This is the single version.
//
// `TDoc` is deliberately open: the contour and stamp tools hold a DesignDoc per
// canvas, the converter a fully built CanvasResult, the tracer the File itself.
// What they share is exactly what is here — one source, N pages, one of them
// current — and nothing else.
// ---------------------------------------------------------------------------

export interface SourceReader<TDoc> {
    (file: File): Promise<{ name: string; aDoc: TDoc[] }>;
}

export interface DocumentSourceOptions<TDoc> {
    /** turns a dropped file into one document per canvas */
    read: SourceReader<TDoc>;
    /** shown when the reader threw something too long or too vague to print */
    fallbackError: string;
    /** GA event fired once a file has been read */
    event?: string;
    /** pick up a design handed over by another tool on mount */
    acceptHandoff?: boolean;
    /** called before each successful read — where a tool clears per-file settings */
    onOpen?: () => void;
}

export interface DocumentSource<TDoc> {
    /** file name without its extension, the stem every export is named after */
    name: string;
    aDoc: TDoc[] | null;
    /** the document being shown, if any */
    doc: TDoc | undefined;
    tab: number;
    setTab: (i: number) => void;
    open: (file: File) => void;
    close: () => void;
    busy: boolean;
    error: string | null;
    setError: (s: string | null) => void;
    /** id of the tool this design was handed over from, if it did not come off disk */
    from: string | null;
    /** true until the very first file has been read — the stage's empty state */
    empty: boolean;
}

/** A thrown value worth printing verbatim, or the tool's own wording. */
const messageFor = (e: unknown, fallback: string): string =>
    e instanceof Error && e.message.length > 0 && e.message.length < 300 ? e.message : fallback;

export function useDocumentSource<TDoc>(options: DocumentSourceOptions<TDoc>): DocumentSource<TDoc> {
    const { read, fallbackError, event, acceptHandoff, onOpen } = options;

    const [name, setName] = useState("");
    const [aDoc, setDocs] = useState<TDoc[] | null>(null);
    const [tab, setTab] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [from, setFrom] = useState<string | null>(null);

    const open = useCallback((file: File) => {
        let bStale = false;
        void (async () => {
            setBusy(true);
            setError(null);
            onOpen?.();
            try {
                // A frame for the busy state to paint before the heavy synchronous
                // work starts — parsing a big project blocks the main thread.
                await new Promise(r => setTimeout(r, 30));
                const o = await read(file);
                if (bStale) return;
                setName(o.name);
                setDocs(o.aDoc);
                setTab(0);
                if (event) trackEvent(event);
            } catch (e) {
                if (bStale) return;
                setDocs(null);
                setError(messageFor(e, fallbackError));
            } finally {
                if (!bStale) setBusy(false);
            }
        })();
        return () => { bStale = true; };
    }, [read, fallbackError, event, onOpen]);

    const close = useCallback(() => {
        setDocs(null);
        setName("");
        setTab(0);
        setError(null);
        setFrom(null);
    }, []);

    // A design handed over by another tool arrives through the same reader a
    // dropped file does — it is only the drop that is skipped.
    useEffect(() => {
        if (!acceptHandoff) return;
        const o = takeHandoff();
        if (!o) return;
        setFrom(o.from);
        open(handoffFile(o));
    }, [acceptHandoff, open]);

    return {
        name,
        aDoc,
        doc: aDoc?.[tab],
        tab,
        setTab,
        open,
        close,
        busy,
        error,
        setError,
        from,
        empty: !aDoc
    };
}
