import { useEffect, useRef, useState } from "react";

// The split download button shared by the tools that write more than one format:
// the main half downloads in the current format, the arrow opens the list.

export const FORMATS = {
    dxf: {
        ext: "dxf",
        label: "DXF",
        note: "default",
        desc: "Universal CAD/CAM format — operations colour-coded, read by every laser and CAM tool"
    },
    fds: {
        ext: "fds",
        label: "Falcon Design Space",
        note: ".fds",
        desc: "Native FDS project — engrave & cut layers already assigned on import"
    },
    svg: {
        ext: "svg",
        label: "SVG",
        note: "vector",
        desc: "Colour-coded vector graphic — images keep their original pixels"
    }
} as const;

export type FormatKey = keyof typeof FORMATS;

export const FORMAT_KEYS = Object.keys(FORMATS) as FormatKey[];

/**
 * The tray-arrow every control that writes a file to disk carries — so "this
 * saves something" is legible before the label is read, and the one control that
 * merely moves you to another tool (see SendTo) cannot be mistaken for one.
 */
export function DownloadIcon({ className = "size-4" }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
    );
}

export interface FormatMenuProps {
    /** the format the main button acts on — not always the one selected, see `blocked` */
    active: FormatKey;
    /** label of the main button — short, since it sits beside other controls */
    label: string;
    /** the file it will write, for the tooltip: too long to put on the button */
    title?: string;
    onDownload: (fmt: FormatKey) => void;
    /** why a format cannot be used here; undefined = it can */
    blocked?: (fmt: FormatKey) => string | undefined;
    /** replaces the format's own one-liner while it is blocked */
    blockedNote?: string;
    disabled?: boolean;
}

export function FormatMenu({ active, label, title, onDownload, blocked, blockedNote, disabled }: FormatMenuProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click or Escape.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent): void => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <div className="flex shadow-lg shadow-violet-500/25">
                <button
                    onClick={() => onDownload(active)}
                    disabled={disabled}
                    title={title}
                    className="flex items-center gap-2 rounded-l-lg bg-linear-to-r from-cyan-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <DownloadIcon />
                    {label}
                </button>
                <button
                    aria-label="Choose download format"
                    aria-expanded={open}
                    aria-haspopup="menu"
                    disabled={disabled}
                    onClick={() => setOpen(o => !o)}
                    className="rounded-r-lg border-l border-white/30 bg-violet-500 px-2.5 text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <svg className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                </button>
            </div>

            {open && (
                <div role="menu" className="absolute top-full right-0 z-30 mt-2 w-80 rounded-xl bg-slate-900/95 p-1.5 ring-1 ring-white/15 backdrop-blur-xl">
                    {FORMAT_KEYS.map(key => {
                        const sBlocked = blocked?.(key);
                        return (
                            <button
                                key={key}
                                role="menuitem"
                                disabled={!!sBlocked}
                                aria-disabled={!!sBlocked}
                                title={sBlocked}
                                onClick={() => { setOpen(false); onDownload(key); }}
                                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${sBlocked ? "cursor-not-allowed opacity-40" : "hover:bg-white/10"}`}
                            >
                                <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${key === active ? "bg-cyan-400 text-slate-900" : "bg-white/10 text-transparent"}`}>✓</span>
                                <span>
                                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                                        {FORMATS[key].label}
                                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                                            {sBlocked ? blockedNote ?? "unavailable" : FORMATS[key].note}
                                        </span>
                                    </span>
                                    <span className="mt-0.5 block text-xs leading-snug text-slate-400">
                                        {sBlocked ?? FORMATS[key].desc}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
