import { AlertTriangle, ChevronUp, ShieldCheck } from "lucide-react";
import { Hint } from "../components/ui/tooltip";
import { cn } from "../lib/cn";
import type { Stat } from "./types";
import type { StageReadout } from "./Stage";

// ---------------------------------------------------------------------------
// The bottom bar: everything the tool worked out, at a glance.
//
// These numbers used to be a four-column <dl> wedged between the preview and the
// sliders — which meant that the one thing you check after every single change
// ("is it still 42 mm wide?") moved down the page as the panel above it grew.
// Here they are pinned, always in the same place, in the same order, and reading
// them costs no scrolling and no eye travel away from the drawing.
//
// Warnings sit here too rather than as banners in the flow: a warning is a fact
// about the result, and the result is what this bar reports.
//
// What is deliberately *not* here is a second way into the explainer overlay.
// One door, in the left panel, where the rest of "what am I looking at" lives.
// ---------------------------------------------------------------------------

export interface StatusbarProps {
    stats: Stat[];
    warnings: string[];
    readout: StageReadout;
    /** the panels a tool can open under the stage; one button each */
    bottomPanels?: { id: string; title: string }[];
    /** id of the open one, or null */
    bottomTab?: string | null;
    onBottomTab?: (id: string) => void;
}

export function Statusbar({ stats, warnings, readout, bottomPanels, bottomTab, onBottomTab }: StatusbarProps) {
    return (
        <footer
            data-testid="statusbar"
            className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[11px] text-muted-foreground"
        >
            {warnings.length > 0 ? (
                <Hint
                    label={
                        <ul className="space-y-1.5">
                            {warnings.map(s => <li key={s}>{s}</li>)}
                        </ul>
                    }
                    side="top"
                >
                    <button className="flex shrink-0 items-center gap-1.5 rounded px-1 text-warn transition-colors hover:bg-warn/10">
                        <AlertTriangle className="size-3" />
                        {warnings.length} {warnings.length === 1 ? "note" : "notes"}
                    </button>
                </Hint>
            ) : (
                <span className="flex shrink-0 items-center gap-1.5 text-subtle-foreground">
                    <ShieldCheck className="size-3" />
                    <span className="hidden sm:inline">Runs in your browser</span>
                </span>
            )}

            <span className="h-3 w-px shrink-0 bg-line" aria-hidden="true" />

            <ul className="scroll-slim flex min-w-0 flex-1 items-center gap-3 overflow-x-auto" aria-label="Result">
                {stats.map(o => (
                    <li key={o.label} className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap" title={o.hint}>
                        <span className="text-subtle-foreground">{o.label}</span>
                        <span className="text-foreground tabular-nums">{o.value}</span>
                    </li>
                ))}
            </ul>

            {bottomPanels?.map(o => {
                const bOpen = bottomTab === o.id;
                return (
                    <button
                        key={o.id}
                        onClick={() => onBottomTab?.(bOpen ? "" : o.id)}
                        aria-expanded={bOpen}
                        className={cn(
                            "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-panel-2 hover:text-foreground",
                            bOpen && "text-foreground"
                        )}
                    >
                        <ChevronUp className={cn("size-3 transition-transform", bOpen && "rotate-180")} />
                        {o.title}
                    </button>
                );
            })}

            <span className="h-3 w-px shrink-0 bg-line" aria-hidden="true" />

            {/* Written to imperatively by the stage — a pan must not re-render
                the workspace, and these two change on every frame of one. */}
            <span className="hidden shrink-0 items-baseline gap-1.5 md:flex" title="Pointer position on the design">
                <span className="text-subtle-foreground">xy</span>
                <span ref={readout.cursor} className="w-28 text-right text-foreground tabular-nums">—</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-1.5" title="Zoom, relative to fit">
                <span ref={readout.zoom} className="w-12 text-right text-foreground tabular-nums">100 %</span>
            </span>
        </footer>
    );
}
