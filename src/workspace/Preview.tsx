import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Hint } from "../components/ui/tooltip";
import { cn } from "../lib/cn";
import { usePanZoom } from "./hooks/usePanZoom";

// ---------------------------------------------------------------------------
// A drawing you can navigate, without being the stage.
//
// The stage is a lot of things the parts sheet has no use for — rulers, a drop
// target, an empty state, picking, a legend. What it and the parts sheet share
// is the part that matters: the same white paper, the same wheel-to-zoom,
// drag-to-pan, double-click-to-fit, and the same corner cluster. That is this,
// and the stage uses the cluster from here so the two can never drift apart.
// ---------------------------------------------------------------------------

/**
 * The +/−/fit cluster, wherever a drawing can be navigated.
 *
 * `subject` names what is being zoomed. Two drawings can be on screen at once —
 * the stamp face and its parts sheet — and two buttons both called "Zoom in" is
 * a coin toss for anyone driving by keyboard or screen reader.
 */
export function ZoomCluster({ zoomBy, resetView, className, subject }: {
    zoomBy: (factor: number) => void;
    resetView: () => void;
    className?: string;
    subject?: string;
}) {
    const of = subject ? ` on the ${subject}` : "";
    return (
        <div className={cn(
            "flex flex-col overflow-hidden rounded-lg bg-panel/90 ring-1 ring-line-strong backdrop-blur",
            className
        )}>
            <Hint label={`Zoom in${of}`} side="left">
                <Button variant="ghost" size="icon-sm" aria-label={`Zoom in${of}`} onClick={() => zoomBy(1.4)}>
                    <Plus className="size-3.5" />
                </Button>
            </Hint>
            <Hint label={`Zoom out${of}`} side="left">
                <Button variant="ghost" size="icon-sm" aria-label={`Zoom out${of}`} onClick={() => zoomBy(1 / 1.4)}>
                    <Minus className="size-3.5" />
                </Button>
            </Hint>
            <Hint label={<>Fit{of} <kbd className="text-subtle-foreground">double-click</kbd></>} side="left">
                <Button variant="ghost" size="icon-sm" aria-label={`Fit${of}`} onClick={resetView}>
                    <Maximize className="size-3.5" />
                </Button>
            </Hint>
        </div>
    );
}

export interface PreviewProps {
    /** SVG markup at true size in millimetres */
    svg: string;
    /** what makes this a different drawing, deserving a refit of the view */
    fitKey: string;
    /** what this drawing is, for the zoom buttons' names */
    subject: string;
    className?: string;
    "data-testid"?: string;
}

export function Preview({ svg, fitKey, subject, className, ...rest }: PreviewProps) {
    const { ref, zoomBy, resetView } = usePanZoom({ content: svg, fitKey });

    return (
        <div className={cn("relative overflow-hidden rounded-lg ring-1 ring-line", className)}>
            <div
                ref={ref}
                data-testid={rest["data-testid"]}
                className="stage-paper size-full cursor-grab touch-none select-none [&[data-panning]]:cursor-grabbing"
                dangerouslySetInnerHTML={{ __html: svg }}
            />
            <ZoomCluster zoomBy={zoomBy} resetView={resetView} subject={subject} className="absolute top-2 right-2 z-10" />
        </div>
    );
}
