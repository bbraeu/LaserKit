import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, LayoutTemplate, Spline } from "lucide-react";
import {
    buildTrace, prepareTrace, readTraceImage, traceToDxf, traceToFds, traceToSvg
} from "../lib/trace";
import type { TraceImage, TraceMode, TracePrep, TraceStyle } from "../lib/trace";
import { r3 } from "../lib/design";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { WidthField } from "../workspace/WidthField";
import { Workspace } from "../workspace/Workspace";
import { SegmentedField, SliderField, ToggleField } from "../workspace/fields";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useDocumentSource } from "../workspace/hooks/useDocumentSource";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Image tracer.
//
// The tool with the most knobs, and therefore the one that gained most from
// grouping them by the stage of the trace they act on:
//
//   Threshold — what counts as ink at all. Nothing downstream matters until
//               this is right, so it is first and on its own.
//   Paths     — how the boundary that came out of it is turned into curves.
//   Cleanup   — what gets thrown away: speckle, or thinning whiskers.
//
// "Fade the image in" and "Show points" left the settings entirely. They never
// touch the export — they are how you *look* at the trace — so they sit with the
// grid and the rulers in the stage's own view cluster.
// ---------------------------------------------------------------------------

/** How faint the source image sits behind the traced vectors. */
const FADE_OPACITY = 0.28;

const MODES = [
    {
        id: "outline" as const,
        label: "Outline",
        hint: "The boundary of every dark region, holes included — a filled logo becomes shapes to engrave or cut."
    },
    {
        id: "centerline" as const,
        label: "Centreline",
        hint: "One line down the middle of every stroke instead of an outline around it — for sketches and line art."
    }
];

const STYLES = [
    { id: "fill" as const, label: "Engrave", hint: "The areas, exported as surface engraving, holes kept by the even-odd rule" },
    { id: "stroke" as const, label: "Cut", hint: "Just the boundary lines, exported as line cutting" }
];

interface TraceParams {
    mode: TraceMode;
    style: TraceStyle;
    threshold: number;
    invert: boolean;
    alpha: boolean;
    minArea: number;
    smooth: number;
    optimize: number;
    prune: number;
    /** width in mm the result is cut at; 0 = the 96 dpi guess on its pixels */
    widthMm: number;
}

/** LightBurn's own defaults, so numbers carry over from that dialog. */
const DEFAULTS: TraceParams = {
    mode: "outline",
    style: "fill",
    threshold: 128,
    invert: false,
    alpha: false,
    minArea: 2,
    smooth: 1,
    optimize: 0.2,
    prune: 4,
    widthMm: 0
};

const TRANSIENT: (keyof TraceParams)[] = ["widthMm"];

const PRESETS: Preset<TraceParams>[] = [
    {
        id: "logo",
        label: "Logo · flat artwork",
        hint: "Clean edges, speckle ignored — engrave the filled areas",
        patch: { mode: "outline", style: "fill", threshold: 128, minArea: 4, smooth: 1, optimize: 0.2 }
    },
    {
        id: "photo",
        label: "Photo · scan",
        hint: "Softer curves and a bigger speckle floor, for a noisy source",
        patch: { mode: "outline", style: "fill", threshold: 150, minArea: 20, smooth: 1.2, optimize: 0.6 }
    },
    {
        id: "lineart",
        label: "Line drawing",
        hint: "One line down each stroke, whiskers pruned — for sketches to line-engrave",
        patch: { mode: "centerline", threshold: 128, smooth: 1, optimize: 0.3, prune: 6 }
    }
];

export default function TraceTool() {
    const params = useHistoryParams<TraceParams>(DEFAULTS, {
        storageKey: "laserkit:params:trace",
        transient: TRANSIENT
    });
    const p = params.value;

    // Preview aids: never exported, so deliberately not part of the settings and
    // therefore not part of the undo history either.
    const [fade, setFade] = useState(true);
    const [showPoints, setShowPoints] = useState(false);

    const [image, setImage] = useState<TraceImage | null>(null);

    const onOpen = useCallback(() => {
        params.resetTransient();
        setImage(null);
    }, [params]);

    const readFile = useCallback(
        (file: File) => Promise.resolve({ name: file.name.replace(/\.[^.]+$/, ""), aDoc: [file] }),
        []
    );

    const source = useDocumentSource<File>({
        read: readFile,
        fallbackError: "This image could not be read.",
        event: "trace_file",
        onOpen
    });
    const file = source.doc;

    // Decoding depends on the mode: a centreline is thinned pass after pass over
    // the whole bitmap, so it is budgeted a smaller working size than an outline.
    const { setError } = source;
    useEffect(() => {
        if (!file) { setImage(null); return; }
        let bStale = false;
        readTraceImage(file, p.mode)
            .then(img => { if (!bStale) { setImage(img); setError(null); } })
            .catch((e: unknown) => {
                if (bStale) return;
                setImage(null);
                setError(e instanceof Error ? e.message : "This image could not be read.");
            });
        return () => { bStale = true; };
    }, [file, p.mode, setError]);

    // The threshold decides the mask, and the mask is what decomposing or
    // thinning works on — so this half only re-runs when the threshold itself
    // moves, and dragging Smooth or Optimize re-fits curves to what is there.
    const prepare = useCallback(
        (img: TraceImage) => prepareTrace(img, { mode: p.mode, threshold: p.threshold, invert: p.invert, alpha: p.alpha }),
        [p.mode, p.threshold, p.invert, p.alpha]
    );
    const prepState = useDebouncedBuild<TraceImage, TracePrep>({
        input: image,
        build: prepare,
        fitKey: "",
        fallbackError: "Tracing failed.",
        delay: 40
    });
    const prep = prepState.result;

    const pair = useMemo(
        () => (image && prep ? { image, prep } : null),
        [image, prep]
    );
    const buildFinal = useCallback(
        ({ image: img, prep: pr }: { image: TraceImage; prep: TracePrep }) => buildTrace(img, pr, {
            minArea: p.minArea,
            smooth: p.smooth,
            optimize: p.optimize,
            prune: p.prune,
            style: p.style,
            widthMm: p.widthMm || undefined
        }),
        [p.minArea, p.smooth, p.optimize, p.prune, p.style, p.widthMm]
    );

    // A new image, mode or scale is a different drawing; the sliders are not, so
    // nudging one must leave the view where the user put it.
    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: pair,
        build: buildFinal,
        fitKey: `${source.name}|${p.mode}|${p.widthMm}`,
        fallbackError: "Tracing failed."
    });

    // The traced vectors over the source image, faded — the quickest way to see
    // whether the threshold is right.
    const preview = useMemo((): string => {
        if (!result || !image) return "";
        const w = r3(result.width),
            h = r3(result.height),
            sw = Math.max(0.05, result.width / 400);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`
            + (fade
                ? `<image href="${image.href}" x="0" y="0" width="${w}" height="${h}"`
                    + ` opacity="${FADE_OPACITY}" preserveAspectRatio="none"/>`
                : "")
            + `<path d="${result.d}" ${result.filled
                ? `fill="${result.operation.css}" fill-rule="evenodd" fill-opacity="0.85"`
                : `fill="none" stroke="${result.operation.css}" stroke-width="${r3(sw)}"`}/>`
            + (showPoints
                ? result.aNode.map(pt => `<circle cx="${r3(pt.x)}" cy="${r3(pt.y)}" r="${r3(sw * 1.6)}"`
                    + ` fill="#ffffff" stroke="#e11d48" stroke-width="${r3(sw * 0.6)}"/>`).join("")
                : "")
            + "</svg>";
    }, [result, image, fade, showPoints]);

    const baseName = `${source.name || "trace"}_traced`;

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem: baseName,
        eventPrefix: "TRACE",
        build: fmt => fmt === "fds"
            ? traceToFds(result)
            : textBlob(fmt === "dxf" ? traceToDxf(result) : traceToSvg(result), fmt)
    }) : []), [result, baseName]);

    const legend: LegendItem[] = result
        ? [{ color: result.operation.css, label: result.operation.name }]
        : [];

    const bCenter = p.mode === "centerline";

    return (
        <Workspace
            toolId="trace"
            subject="Trace"
            subtitle={result ? `${result.width.toFixed(1)} × ${result.height.toFixed(1)} mm` : undefined}
            documentName={source.name}
            from={source.from}
            tabs={[]}
            tab={0}
            onTab={() => undefined}
            empty={source.empty}
            busy={source.busy || (!!file && !image && !source.error)}
            error={source.error ?? error ?? prepState.error}
            onOpenFile={source.open}
            onClose={() => { source.close(); setImage(null); }}
            params={params}
            stage={{ svg: preview, fitKey, pending: pending || prepState.pending }}
            stageToggles={[
                {
                    id: "fade",
                    label: "Fade the source image in",
                    icon: <Eye className="size-3.5" />,
                    on: fade,
                    onToggle: () => setFade(b => !b)
                },
                {
                    id: "points",
                    label: "Show every path node",
                    icon: <Spline className="size-3.5" />,
                    on: showPoints,
                    onToggle: () => setShowPoints(b => !b)
                }
            ]}
            legend={legend}
            stats={result ? [
                { label: "Size", value: `${result.width.toFixed(1)} × ${result.height.toFixed(1)} mm` },
                { label: bCenter ? "Lines" : "Paths", value: String(result.paths) },
                { label: "Nodes", value: String(result.nodes) },
                {
                    label: "Accuracy",
                    value: `± ${result.accuracy.toFixed(3)} mm`,
                    hint: "A bitmap has no curves in it, so a trace is always an interpretation — this is what the fit actually cost."
                },
                ...(image ? [{ label: "Source", value: `${image.sourceWidth}×${image.sourceHeight} px` }] : [])
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: baseName, svg: () => (result ? traceToSvg(result) : ""), disabled: !result }}
            emptyTitle="Drop a PNG, JPEG, GIF, BMP or WebP here"
            emptySub="or click to browse — the trace runs entirely in your browser, nothing is uploaded"
            sidebarBlocks={[{
                id: "trace-presets",
                title: "Presets",
                icon: <LayoutTemplate className="size-3" />,
                children: (
                    <PresetList
                        presets={PRESETS}
                        current={p}
                        onApply={(patch, label) => params.set(patch, { label })}
                    />
                )
            }]}
        >
            {/* ── What counts as ink ─────────────────────────────────────── */}
            <PanelSection id="trace-threshold" title="Threshold">
                <SliderField
                    label={p.alpha ? "Opacity threshold" : "Brightness threshold"}
                    hint={`${p.alpha ? "Anything more opaque than this counts as shape." : "Anything darker than this counts as shape."} Fade the image in on the canvas and move this until the outline sits where you want it.`}
                    value={p.threshold}
                    min={0}
                    max={255}
                    step={1}
                    unit=""
                    onChange={n => params.set({ threshold: n }, { label: "Threshold", coalesce: "threshold" })}
                />
                <ToggleField
                    label="Invert"
                    hint="Trace the light side instead — for white artwork on a dark ground."
                    checked={p.invert}
                    onChange={b => params.set({ invert: b }, { label: "Invert" })}
                />
                <ToggleField
                    label="Judge by transparency"
                    hint="Use the alpha channel rather than brightness, so a cut-out PNG traces its silhouette whatever colour it is."
                    checked={p.alpha}
                    onChange={b => params.set({ alpha: b }, { label: "Trace transparency" })}
                />
            </PanelSection>

            {/* ── Turning the boundary into curves ───────────────────────── */}
            <PanelSection id="trace-paths" title="Paths">
                <SegmentedField
                    label="Trace as"
                    hint={MODES.find(o => o.id === p.mode)!.hint}
                    value={p.mode}
                    choices={MODES}
                    onChange={v => params.set({ mode: v }, { label: "Trace mode" })}
                />
                <SliderField
                    label="Smooth"
                    hint="How much of a bend may be rounded into a curve instead of kept as a corner. At 0 you get a plain polygon; at 1 a traced circle comes out as curves while a traced square keeps its four corners."
                    value={p.smooth}
                    min={0}
                    max={1.334}
                    step={0.01}
                    unit=""
                    onChange={n => params.set({ smooth: n }, { label: "Smooth", coalesce: "smooth" })}
                />
                <SliderField
                    label="Optimize"
                    hint="How far a node may be moved to be rid of it. 0 is already clean — a traced boundary is a staircase, and half a pixel of it is absorbed before this slider adds anything. The accuracy in the status bar is what it actually cost."
                    value={p.optimize}
                    min={0}
                    max={4}
                    step={0.05}
                    unit="px"
                    onChange={n => params.set({ optimize: n }, { label: "Optimize", coalesce: "optimize" })}
                />
            </PanelSection>

            {/* ── What gets thrown away ──────────────────────────────────── */}
            <PanelSection id="trace-cleanup" title="Cleanup">
                {bCenter ? (
                    <SliderField
                        label="Shortest branch"
                        hint="Thinning leaves a little barb wherever the edge of a stroke bulges. Anything shorter than this is dropped — raise it until the whiskers are gone, then stop, or real short strokes go with them."
                        value={p.prune}
                        min={0}
                        max={80}
                        step={1}
                        unit="px"
                        onChange={n => params.set({ prune: n }, { label: "Shortest branch", coalesce: "prune" })}
                    />
                ) : (
                    <SliderField
                        label="Ignore smaller than"
                        hint="Shapes and holes enclosing fewer pixels than this are left out — which is how JPEG speckle and scanner dust stop becoming hundreds of tiny cut paths."
                        value={p.minArea}
                        min={0}
                        max={400}
                        step={1}
                        unit="px"
                        onChange={n => params.set({ minArea: n }, { label: "Ignore smaller than", coalesce: "minArea" })}
                    />
                )}
            </PanelSection>

            {/* ── What the laser does with it ────────────────────────────── */}
            <PanelSection id="trace-laser" title="Laser">
                {bCenter ? (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        A centreline exports as line engraving — one open path per stroke. Reassign the operation in
                        your laser software if you want it cut instead.
                    </p>
                ) : (
                    <>
                        <SegmentedField
                            label="Operation"
                            hint={STYLES.find(o => o.id === p.style)!.hint}
                            value={p.style}
                            choices={STYLES}
                            onChange={v => params.set({ style: v }, { label: "Operation" })}
                        />
                        <p className="text-[11px] leading-relaxed text-subtle-foreground">
                            Filled outlines export as one even-odd path in surface-engraving blue; cut outlines in red.
                        </p>
                    </>
                )}
            </PanelSection>

            {/* ── A bitmap never states how big it is ────────────────────── */}
            {image && (
                <WidthField
                    label="Traced width"
                    value={p.widthMm}
                    guess={(image.sourceWidth * 25.4) / 96}
                    reason="A bitmap carries no physical size, so 96 dpi is assumed on its pixels."
                    because="Every millimetre figure in the status bar follows it."
                    onChange={n => params.set({ widthMm: n }, { label: "Traced width", coalesce: "width" })}
                />
            )}
        </Workspace>
    );
}
