import type { ReactNode } from "react";
import { MousePointerSquareDashed, RotateCcw } from "lucide-react";
import { Button } from "../components/ui/button";
import { Hint } from "../components/ui/tooltip";
import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// The right panel: the properties of what is on the stage, and nothing else.
//
// No global setting is allowed in here — not the export format, not the tool
// you are in, not a view preference. That is the constraint that makes the panel
// readable: everything in it changes the geometry, so scanning it answers
// exactly one question, "what would I change to make this different?".
//
// A header of its own carries the one action that is about the *whole* set of
// properties rather than any single one: put them back.
// ---------------------------------------------------------------------------

export interface InspectorProps {
    open: boolean;
    /** what the properties belong to: "Stamp", "Cut line", "Trace" */
    subject: string;
    /** a short line under the title — the size, the source, the selection */
    subtitle?: string;
    /** nothing loaded: the panel says so rather than showing dead controls */
    empty: boolean;
    onReset: () => void;
    canReset: boolean;
    children: ReactNode;
}

export function Inspector({ open, subject, subtitle, empty, onReset, canReset, children }: InspectorProps) {
    return (
        <aside
            aria-label="Properties"
            data-testid="inspector"
            className={cn(
                "flex w-inspector shrink-0 flex-col overflow-hidden border-l border-line bg-panel",
                "max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:shadow-2xl max-xl:shadow-black/60",
                !open && "hidden"
            )}
        >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{subject}</p>
                    {subtitle && <p className="truncate text-[10px] text-subtle-foreground">{subtitle}</p>}
                </div>
                <Hint label="Put every property back to its default" side="left">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Reset properties"
                        disabled={!canReset || empty}
                        onClick={onReset}
                    >
                        <RotateCcw className="size-3.5" />
                    </Button>
                </Hint>
            </div>

            <div className="scroll-slim flex-1 overflow-y-auto overscroll-contain">
                {empty ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                        <MousePointerSquareDashed className="size-6 text-subtle-foreground" />
                        <p className="text-xs leading-relaxed text-subtle-foreground">
                            Nothing on the canvas yet.
                            <br />
                            Open a file and its properties appear here.
                        </p>
                    </div>
                ) : (
                    children
                )}
            </div>
        </aside>
    );
}
