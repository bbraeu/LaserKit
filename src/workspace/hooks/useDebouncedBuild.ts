import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Re-running a tool's geometry when its settings change.
//
// Three tools carried the same effect, down to the same subtlety in the same
// comment: the fit key has to be published *with* the result and not derived
// beside it. A new design width reaches the component one render before the
// geometry it rescales, so a fit key read from the settings would refit the view
// to the drawing that is on its way out, leaving the incoming one at the wrong
// zoom. Setting both in one state update is what makes that impossible.
//
// The short delay is the other half: dragging a slider must not queue one full
// rebuild per pixel of travel.
// ---------------------------------------------------------------------------

/** Long enough to swallow a drag's intermediate frames, short enough to feel live. */
export const BUILD_DELAY_MS = 30;

export interface BuildState<TOut> {
    result: TOut | null;
    error: string | null;
    /** the fit key that belongs to *this* result */
    fitKey: string;
    /** a rebuild is queued — the stage dims very slightly rather than flickering */
    pending: boolean;
}

export interface DebouncedBuildOptions<TIn, TOut> {
    /** null while there is nothing to build from; the last result is then kept */
    input: TIn | null | undefined;
    /**
     * MUST be stable — wrap it in useCallback whose deps are the settings it
     * reads. That callback's identity *is* the "have the settings changed?"
     * signal this hook rebuilds on; an inline arrow would rebuild on every
     * render, and since a rebuild re-renders, it would never stop.
     */
    build: (input: TIn) => TOut;
    /** what makes this a *different drawing*, deserving a refit of the view */
    fitKey: string;
    /** used when the builder throws something unprintable */
    fallbackError: string;
    delay?: number;
}

export function useDebouncedBuild<TIn, TOut>(o: DebouncedBuildOptions<TIn, TOut>): BuildState<TOut> {
    const { input, build, fitKey, fallbackError, delay = BUILD_DELAY_MS } = o;
    const [state, setState] = useState<BuildState<TOut>>({
        result: null,
        error: null,
        fitKey: "",
        pending: false
    });

    useEffect(() => {
        if (input === null || input === undefined) return;
        setState(s => (s.pending ? s : { ...s, pending: true }));
        const id = setTimeout(() => {
            try {
                const result = build(input);
                setState({ result, error: null, fitKey, pending: false });
            } catch (e) {
                setState(s => ({
                    ...s,
                    result: null,
                    pending: false,
                    error: e instanceof Error && e.message.length < 300 ? e.message : fallbackError
                }));
            }
        }, delay);
        return () => clearTimeout(id);
    }, [input, build, fitKey, fallbackError, delay]);

    return state;
}
