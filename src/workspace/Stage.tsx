import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Crosshair, Grid3x3, Loader2, Ruler, UploadCloud } from "lucide-react";
import { Button } from "../components/ui/button";
import { Hint } from "../components/ui/tooltip";
import { cn } from "../lib/cn";
import { usePanZoom } from "./hooks/usePanZoom";
import type { ViewInfo } from "./hooks/usePanZoom";
import { ZoomCluster } from "./Preview";
import { drawRuler, gridSteps } from "./rulers";
import type { LegendItem, StageSpec } from "./types";

// ---------------------------------------------------------------------------
// The stage: the drawing, and nothing that is not about the drawing.
//
// This is the 70 % the brief asks for, and it earns it by refusing everything
// else. What lives here is what you can only judge by looking: the geometry, the
// millimetre rulers around it, the grid under it, the colours in it, and the
// controls for the view itself. A setting that changes the *result* belongs in
// the inspector, even when it is tempting to put it "right where you can see
// it" — that temptation is exactly how the old toolbar row grew.
//
// Nothing in here re-renders while you pan. The rulers are canvases redrawn from
// the pan/zoom hook's per-frame callback, the grid is four CSS custom properties
// on one element, and the readouts are text nodes written through refs.
// ---------------------------------------------------------------------------

/** Below this much pointer travel a press counts as a click, not a pan. */
const CLICK_SLOP = 4;

/** Matches --spacing-ruler in global.css; the offsets below are in JS. */
const RULER_PX = 20;

export interface ViewPrefs {
    grid: boolean;
    rulers: boolean;
    centre: boolean;
}

export interface StageReadout {
    /** the status bar's zoom field, written to imperatively */
    zoom: React.RefObject<HTMLSpanElement | null>;
    /** the status bar's cursor field */
    cursor: React.RefObject<HTMLSpanElement | null>;
}

/** What the workspace's keyboard shortcuts need from the stage. */
export interface StageApi {
    zoomBy: (factor: number) => void;
    resetView: () => void;
}

export interface StageProps {
    spec: StageSpec;
    /** nothing loaded yet — the stage *is* the drop zone */
    empty: boolean;
    busy: boolean;
    accept: string;
    onOpenFile: (file: File) => void;
    emptyTitle: string;
    emptySub: string;
    busyTitle?: string;
    busySub?: string;
    legend?: LegendItem[];
    prefs: ViewPrefs;
    onPrefs: (patch: Partial<ViewPrefs>) => void;
    /**
     * Tool-specific *view* aids, shown in the same cluster as grid and rulers.
     * The tracer's "fade the image in" and "show points" belong here rather than
     * in the inspector: they change what you see, never what gets exported, and
     * the panel that changes the result has to stay the panel that changes the
     * result.
     */
    extraToggles?: { id: string; label: string; icon: ReactNode; on: boolean; onToggle: () => void }[];
    readout?: StageReadout;
    /** shown over the stage — the reader's error, or the builder's */
    error?: string | null;
    /** filled in with the zoom controls, so the workspace can bind them to keys */
    apiRef?: React.RefObject<StageApi | null>;
    className?: string;
}

export function Stage(props: StageProps) {
    const { spec, prefs, readout } = props;
    // The per-frame callback below is created once; it reads the current spec
    // through a ref rather than closing over a stale one.
    const specRef = useRef(spec);
    specRef.current = spec;
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const rulerTopRef = useRef<HTMLCanvasElement>(null);
    const rulerLeftRef = useRef<HTMLCanvasElement>(null);
    const centreVRef = useRef<HTMLDivElement>(null);
    const centreHRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLButtonElement>(null);
    /** the drawing's own centre in millimetres, recomputed only when it changes */
    const centreRef = useRef<{ x: number; y: number } | null>(null);

    // The pan/zoom container is also the paper the grid is painted on, so the
    // hook's ref is what the grid variables are written to. Held in a ref of our
    // own because the callback below is created before the hook is called.
    const paperRef = useRef<HTMLDivElement | null>(null);

    // One callback for everything that follows the view. It runs at most once per
    // animation frame and touches the DOM directly — no state, so no re-render
    // and no dropped frames while a 40 000-point contour is being dragged.
    const onView = useCallback((v: ViewInfo) => {
        const paper = paperRef.current;
        if (paper) {
            // The grid is a CSS background in *screen* pixels, so it has to be
            // re-derived from the view on every frame: the square size from the
            // zoom, and the origin from where the drawing's 0,0 currently is —
            // which is what makes it slide with the drawing rather than sit
            // still under it.
            const { minor, major } = gridSteps(v.pxPerMm);
            paper.style.setProperty("--grid-minor", `${minor * v.pxPerMm}px`);
            paper.style.setProperty("--grid-major", `${major * v.pxPerMm}px`);
            paper.style.setProperty("--grid-x", `${-v.x * v.pxPerMm}px`);
            paper.style.setProperty("--grid-y", `${-v.y * (v.clientHeight / v.h)}px`);
        }
        if (rulerTopRef.current) drawRuler(rulerTopRef.current, v, true);
        if (rulerLeftRef.current) drawRuler(rulerLeftRef.current, v, false);

        const c = centreRef.current;
        if (c && centreVRef.current && centreHRef.current) {
            centreVRef.current.style.left = `${(c.x - v.x) * v.pxPerMm}px`;
            centreHRef.current.style.top = `${(c.y - v.y) * (v.clientHeight / v.h)}px`;
        }
        const grip = handleRef.current;
        if (grip && specRef.current.handle) {
            grip.style.left = `${(specRef.current.handle.x - v.x) * v.pxPerMm}px`;
            grip.style.top = `${(specRef.current.handle.y - v.y) * (v.clientHeight / v.h)}px`;
        }
        if (readout?.zoom.current) {
            readout.zoom.current.textContent = `${Math.round(v.relative * 100)} %`;
        }
    }, [readout]);

    const { ref: stageRef, zoomBy, resetView, toDrawing, read } = usePanZoom({
        content: spec.svg,
        fitKey: spec.fitKey,
        onView
    });

    useEffect(() => {
        if (!props.apiRef) return;
        props.apiRef.current = { zoomBy, resetView };
        return () => { if (props.apiRef) props.apiRef.current = null; };
    }, [props.apiRef, zoomBy, resetView]);

    // The drawing's centre, for the centring aid. Read once per drawing rather
    // than per frame: getBBox forces a layout of the whole SVG.
    useEffect(() => {
        const svg = stageRef.current?.querySelector("svg");
        if (!svg) { centreRef.current = null; return; }
        try {
            const b = svg.getBBox();
            centreRef.current = b.width > 0 ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
        } catch {
            centreRef.current = null;
        }
        const v = read();
        if (v) onView(v);
    }, [spec.svg, stageRef, read, onView]);

    // Redraw the rulers when they are switched back on, the stage resizes, or
    // the handle moved because something other than a drag moved it.
    useEffect(() => {
        const v = read();
        if (v) onView(v);
    }, [prefs.grid, prefs.rulers, prefs.centre, spec.handle?.x, spec.handle?.y, read, onView]);

    // Picking is hit-tested against the geometry, not the click target: panning
    // captures the pointer and would retarget the event.
    const pressRef = useRef<{ x: number; y: number } | null>(null);
    const onClick = (e: React.MouseEvent): void => {
        if (!spec.onPick) return;
        const press = pressRef.current;
        if (press && (Math.abs(e.clientX - press.x) > CLICK_SLOP || Math.abs(e.clientY - press.y) > CLICK_SLOP)) {
            return; // that was a pan
        }
        const p = toDrawing(e.clientX, e.clientY);
        if (p) spec.onPick(p);
    };

    const onPointerMove = (e: React.PointerEvent): void => {
        const el = readout?.cursor.current;
        if (!el) return;
        const p = toDrawing(e.clientX, e.clientY);
        el.textContent = p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)} mm` : "—";
    };

    const takeFile = (file: File | undefined): void => {
        if (file) props.onOpenFile(file);
    };

    const pad = prefs.rulers ? RULER_PX : 0;

    return (
        <section
            aria-label="Canvas"
            className={cn("relative min-w-0 bg-background", props.className)}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
            onDrop={e => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]); }}
        >
            <input
                ref={fileRef}
                type="file"
                accept={props.accept}
                className="hidden"
                data-testid="stage-file-input"
                onChange={e => { takeFile(e.target.files?.[0]); e.target.value = ""; }}
            />

            {/* ── rulers ─────────────────────────────────────────────────── */}
            {prefs.rulers && !props.empty && (
                <>
                    {/* Each canvas sits in a positioned wrapper and fills it. A
                        canvas is a replaced element: given `left` and `right` with
                        no width it keeps its intrinsic 2:1 ratio instead of
                        stretching, which collapses a full-width ruler to 40 px. */}
                    <div
                        className="pointer-events-none absolute top-0 right-0 z-20 h-ruler"
                        style={{ left: pad }}
                        aria-hidden="true"
                    >
                        <canvas ref={rulerTopRef} className="block size-full" />
                    </div>
                    <div
                        className="pointer-events-none absolute bottom-0 left-0 z-20 w-ruler"
                        style={{ top: pad }}
                        aria-hidden="true"
                    >
                        <canvas ref={rulerLeftRef} className="block size-full" />
                    </div>
                    {/* The corner the two rulers do not cover */}
                    <div className="absolute top-0 left-0 z-20 size-ruler bg-panel" aria-hidden="true" />
                </>
            )}

            {/* ── the drawing ────────────────────────────────────────────── */}
            <div className="absolute inset-0 overflow-hidden" style={{ top: pad, left: pad }}>
                {props.empty ? (
                    <EmptyStage
                        title={props.busy ? props.busyTitle ?? "Reading…" : props.emptyTitle}
                        sub={props.busy ? props.busySub ?? "" : props.emptySub}
                        busy={props.busy}
                        onBrowse={() => fileRef.current?.click()}
                    />
                ) : (
                    <>
                        <div
                            // One element, two owners: the hook drives the view
                            // on it, the grid is painted on it.
                            ref={el => { stageRef.current = el; paperRef.current = el; }}
                            data-testid="stage-canvas"
                            data-grid={prefs.grid ? "on" : "off"}
                            onPointerDown={e => { pressRef.current = { x: e.clientX, y: e.clientY }; }}
                            onPointerMove={onPointerMove}
                            onPointerLeave={() => { if (readout?.cursor.current) readout.cursor.current.textContent = "—"; }}
                            onClick={onClick}
                            className={cn(
                                "stage-paper size-full touch-none select-none",
                                spec.picking ? "cursor-pointer" : "cursor-grab",
                                "[&[data-panning]]:cursor-grabbing",
                                spec.pending && "opacity-90 transition-opacity"
                            )}
                            dangerouslySetInnerHTML={{ __html: spec.svg }}
                        />

                        {spec.handle && (
                            <button
                                ref={handleRef}
                                data-testid="stage-handle"
                                aria-label={spec.handle.label}
                                title={spec.handle.label}
                                // The grip moves itself while it is dragged and
                                // reports only once, on release. Reporting per
                                // frame would rebuild the whole drawing sixteen
                                // times a second to answer a question the user
                                // has not finished asking.
                                onPointerDown={e => {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                    e.currentTarget.dataset.dragging = "true";
                                }}
                                onPointerMove={e => {
                                    const el = e.currentTarget;
                                    if (!el.dataset.dragging) return;
                                    const rect = el.parentElement?.getBoundingClientRect();
                                    if (!rect) return;
                                    el.style.left = `${e.clientX - rect.left}px`;
                                    el.style.top = `${e.clientY - rect.top}px`;
                                }}
                                onPointerUp={e => {
                                    const el = e.currentTarget;
                                    if (el.dataset.dragging) {
                                        delete el.dataset.dragging;
                                        const q = toDrawing(e.clientX, e.clientY);
                                        if (q) specRef.current.handle?.onMove(q);
                                    }
                                    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
                                }}
                                onPointerCancel={e => { delete e.currentTarget.dataset.dragging; }}
                                className={cn(
                                    "absolute z-20 size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full",
                                    "border-2 border-accent bg-panel/80 shadow-lg shadow-black/40 backdrop-blur",
                                    "transition-transform hover:scale-125 [&[data-dragging]]:scale-125 [&[data-dragging]]:cursor-grabbing"
                                )}
                            />
                        )}

                        {prefs.centre && (
                            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                                <div ref={centreVRef} className="absolute inset-y-0 w-px bg-accent/45" />
                                <div ref={centreHRef} className="absolute inset-x-0 h-px bg-accent/45" />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── what the colours mean ──────────────────────────────────── */}
            {!props.empty && props.legend && props.legend.length > 0 && (
                <ul
                    aria-label="Colours in this drawing"
                    className="pointer-events-none absolute bottom-3 left-3 z-30 flex max-w-[60%] flex-wrap gap-1.5"
                    style={{ marginLeft: pad }}
                >
                    {props.legend.map(o => (
                        <li
                            key={o.label}
                            className="flex items-center gap-1.5 rounded-md bg-panel/90 px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-line-strong backdrop-blur"
                        >
                            <span
                                className={cn("size-2 shrink-0 rounded-full", o.outlined && "ring-1 ring-line-strong")}
                                style={{ background: o.color }}
                                aria-hidden="true"
                            />
                            {o.label}
                        </li>
                    ))}
                </ul>
            )}

            {/* ── view controls ──────────────────────────────────────────── */}
            {!props.empty && (
                <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-2">
                    <div className="flex overflow-hidden rounded-lg bg-panel/90 ring-1 ring-line-strong backdrop-blur">
                        <StageToggle
                            on={prefs.grid}
                            label="Grid"
                            onClick={() => props.onPrefs({ grid: !prefs.grid })}
                            icon={<Grid3x3 className="size-3.5" />}
                        />
                        <StageToggle
                            on={prefs.rulers}
                            label="Rulers"
                            onClick={() => props.onPrefs({ rulers: !prefs.rulers })}
                            icon={<Ruler className="size-3.5" />}
                        />
                        <StageToggle
                            on={prefs.centre}
                            label="Centre guides"
                            onClick={() => props.onPrefs({ centre: !prefs.centre })}
                            icon={<Crosshair className="size-3.5" />}
                        />
                        {props.extraToggles?.map(o => (
                            <StageToggle key={o.id} on={o.on} label={o.label} onClick={o.onToggle} icon={o.icon} />
                        ))}
                    </div>

                    <ZoomCluster zoomBy={zoomBy} resetView={resetView} />
                </div>
            )}

            {/* ── the state of the stage ─────────────────────────────────── */}
            {spec.pending && !props.empty && (
                <span className="absolute top-3 left-3 z-30 flex items-center gap-1.5 rounded-md bg-panel/90 px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-line-strong backdrop-blur"
                    style={{ marginLeft: pad }}>
                    <Loader2 className="size-3 animate-spin" />
                    Recomputing
                </span>
            )}

            {props.error && (
                <div
                    role="alert"
                    className="absolute inset-x-4 bottom-14 z-40 mx-auto max-w-lg rounded-lg border border-danger/30 bg-[#1b0f14]/95 px-4 py-3 text-xs leading-relaxed text-danger shadow-xl backdrop-blur"
                >
                    {props.error}
                </div>
            )}

            {dragOver && (
                <div className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-sm">
                    <p className="flex items-center gap-2 text-sm font-medium text-accent">
                        <UploadCloud className="size-4" />
                        Drop to open
                    </p>
                </div>
            )}
        </section>
    );
}

function StageToggle({ on, label, icon, onClick }: {
    on: boolean;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <Hint label={`${label} — ${on ? "on" : "off"}`} side="bottom">
            <Button
                variant="ghost"
                size="icon-sm"
                aria-pressed={on}
                aria-label={label}
                onClick={onClick}
                className={on ? "text-accent" : "text-subtle-foreground"}
            >
                {icon}
            </Button>
        </Hint>
    );
}

function EmptyStage({ title, sub, busy, onBrowse }: {
    title: string;
    sub: string;
    busy: boolean;
    onBrowse: () => void;
}) {
    return (
        <div className="grid size-full place-items-center p-8">
            <button
                type="button"
                onClick={onBrowse}
                disabled={busy}
                data-testid="empty-drop"
                className={cn(
                    "group flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong",
                    "bg-panel/40 px-8 py-14 text-center transition-colors",
                    "hover:border-accent/50 hover:bg-panel/70 disabled:cursor-wait"
                )}
            >
                <span className="grid size-12 place-items-center rounded-xl bg-panel-2 text-muted-foreground ring-1 ring-line transition-colors group-hover:text-accent">
                    {busy ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
                </span>
                <span>
                    <span className="block text-sm font-medium text-foreground">{title}</span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{sub}</span>
                </span>
            </button>
        </div>
    );
}
