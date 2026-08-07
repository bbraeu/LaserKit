import { useEffect, useRef, useState } from "react";
import { handoffTargets, sendToTool } from "../lib/handoff";
import { getTool } from "../lib/tools";
import { trackEvent } from "../lib/util";

// "Open in …" — hands what this tool just made to the next one without the round
// trip through the download folder. See lib/handoff.ts for how it travels.
//
// Deliberately not shaped like the download buttons, and not placed with them
// either: those write a file and end the job, this one saves nothing and takes
// you somewhere else. So it is a quiet cyan link with an arrow leading out of it,
// sitting in its own row directly under the preview — where you are looking when
// you decide the design is right, and nowhere near the header's download cluster.
//
// Always a menu, even when only one tool can take the design: the label then
// stays honest about what the control is, and you see where you are going before
// the page moves under you.

/** The arrow that says "this leads onwards" rather than "this saves". */
const ArrowIcon = () => (
    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
);

/** Sized to sit inline beside the file name, not to match a download button. */
const LINK_CLASS = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-cyan-300/90 ring-1 ring-cyan-400/25 transition hover:bg-cyan-400/10 hover:text-cyan-200 hover:ring-cyan-400/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:ring-white/10 disabled:hover:bg-transparent";

export interface SendToProps {
    /** id of the tool doing the sending, so it is not offered as a target */
    from: string;
    /** file name stem to carry over */
    name: string;
    /** built only once a target is picked — the SVG can be large */
    svg: () => string;
    disabled?: boolean;
}

export function SendTo({ from, name, svg, disabled }: SendToProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const aTarget = handoffTargets(from);

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

    if (!aTarget.length) return null;

    const send = (to: string): void => {
        setOpen(false);
        // Event names as configured in Google Analytics: SEND_trace_to_stamp, …
        trackEvent(`SEND_${from}_to_${to}`);
        sendToTool(to, { svg: svg(), name, from });
    };

    return (
        // The rule underneath closes the row off: everything below it is about
        // this tool's own result, everything above it is the design itself.
        <div ref={ref} className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 pb-4">
            <div className="relative">
                <button
                    aria-expanded={open}
                    aria-haspopup="menu"
                    disabled={disabled}
                    onClick={() => setOpen(o => !o)}
                    className={LINK_CLASS}
                >
                    {/* The arrow leads the eye out of the label: this hands the design on */}
                    Send to other tool
                    <ArrowIcon />
                    <svg className={`size-4 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                </button>

                {open && (
                    <div role="menu" className="absolute top-full left-0 z-30 mt-2 w-72 rounded-xl bg-slate-900/95 p-1.5 ring-1 ring-white/15 backdrop-blur-xl">
                        {aTarget.map(id => {
                            const oTo = getTool(id);
                            return (
                                <button
                                    key={id}
                                    role="menuitem"
                                    onClick={() => send(id)}
                                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10"
                                >
                                    <span className="flex-1">
                                        <span className="block text-sm font-semibold text-white">{oTo.label}</span>
                                        <span className="mt-0.5 block text-xs leading-snug text-slate-400">{oTo.hint}</span>
                                    </span>
                                    <span className="text-cyan-300/80"><ArrowIcon /></span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <span className="text-xs leading-snug text-slate-500">
                Carries this design straight on to the next tool — no file saved, nothing uploaded.
            </span>
        </div>
    );
}
