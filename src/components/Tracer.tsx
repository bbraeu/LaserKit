import { useCallback, useEffect, useState } from "react";
import {
    buildTrace, prepareTrace, readTraceImage, traceToDxf, traceToFds, traceToSvg
} from "../lib/trace";
import type { TraceImage, TraceMode, TracePrep, TraceResult, TraceStyle } from "../lib/trace";
import { r3 } from "../lib/design";
import { downloadBlob, trackEvent } from "../lib/util";
import { DropZone } from "./DropZone";
import { FIELD_CLASS, NumberField } from "./NumberField";
import { FORMATS, FormatMenu } from "./FormatMenu";
import type { FormatKey } from "./FormatMenu";
import { usePanZoom, ZoomControls, PanHint } from "./PanZoom";

/** How faint the source image sits behind the traced vectors. */
const FADE_OPACITY = 0.28;

const MODES: { id: TraceMode; label: string; hint: string }[] = [
    {
        id: "outline",
        label: "Outline",
        hint: "The boundary of every dark region, holes included — a filled logo becomes shapes to engrave or cut."
    },
    {
        id: "centerline",
        label: "Centreline",
        hint: "One line down the middle of every stroke instead of an outline around it — for sketches and line art."
    }
];

const STYLES: { id: TraceStyle; label: string; hint: string }[] = [
    { id: "fill", label: "Filled", hint: "The areas, to engrave — exported as surface engraving, holes kept by the even-odd rule" },
    { id: "stroke", label: "Outlines", hint: "Just the boundary lines, to cut — exported as line cutting" }
];

export default function Tracer() {
    const [file, setFile] = useState<File | null>(null);
    const [image, setImage] = useState<TraceImage | null>(null);
    const [prep, setPrep] = useState<TracePrep | null>(null);
    const [result, setResult] = useState<TraceResult | null>(null);

    const [mode, setMode] = useState<TraceMode>("outline");
    const [style, setStyle] = useState<TraceStyle>("fill");
    // LightBurn's own defaults, so numbers carry over from that dialog.
    const [threshold, setThreshold] = useState(128);
    const [invert, setInvert] = useState(false);
    const [alpha, setAlpha] = useState(false);
    const [minArea, setMinArea] = useState(2);
    const [smooth, setSmooth] = useState(1);
    const [optimize, setOptimize] = useState(0.2);
    const [prune, setPrune] = useState(4);
    const [widthMm, setWidthMm] = useState<number | undefined>(undefined);

    const [fade, setFade] = useState(true);
    const [showPoints, setShowPoints] = useState(false);

    const [format, setFormat] = useState<FormatKey>("svg");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [fitKey, setFitKey] = useState("");

    const openFile = useCallback((f: File) => {
        setFile(f);
        setResult(null);
        setPrep(null);
        setWidthMm(undefined);
        trackEvent("trace_file");
    }, []);

    // Decoding depends on the mode: a centreline is thinned pass after pass over
    // the whole bitmap, so it is budgeted a smaller working size than an outline.
    useEffect(() => {
        if (!file) return;
        let bStale = false;
        setBusy(true);
        readTraceImage(file, mode)
            .then(img => { if (!bStale) { setImage(img); setError(null); } })
            .catch((e: unknown) => {
                if (bStale) return;
                setImage(null);
                setError(e instanceof Error ? e.message : "This image could not be read.");
            })
            .finally(() => { if (!bStale) setBusy(false); });
        return () => { bStale = true; };
    }, [file, mode]);

    // The threshold decides the mask, and the mask is what decomposing or thinning
    // works on — so this half only re-runs when the threshold itself moves, and
    // dragging Smooth or Optimize re-fits curves to what is already there.
    useEffect(() => {
        if (!image) return;
        const id = setTimeout(() => {
            try {
                setPrep(prepareTrace(image, { mode, threshold, invert, alpha }));
                setError(null);
            } catch (e) {
                setPrep(null);
                setError(e instanceof Error ? e.message : "Tracing failed.");
            }
        }, 40);
        return () => clearTimeout(id);
    }, [image, mode, threshold, invert, alpha]);

    useEffect(() => {
        if (!image || !prep) return;
        const id = setTimeout(() => {
            try {
                setResult(buildTrace(image, prep, { minArea, smooth, optimize, prune, style, widthMm }));
                // A new image, mode or scale is a different drawing; the sliders are
                // not, so nudging one must leave the view where the user put it.
                setFitKey(`${file?.name ?? ""}|${mode}|${widthMm ?? ""}`);
                setError(null);
            } catch (e) {
                setResult(null);
                setError(e instanceof Error ? e.message : "Tracing failed.");
            }
        }, 30);
        return () => clearTimeout(id);
    }, [image, prep, minArea, smooth, optimize, prune, style, widthMm, mode, file]);

    // The traced vectors over the source image, faded — LightBurn's "Bild
    // verblassen", and the quickest way to see whether the threshold is right.
    const preview = ((): string => {
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
                ? result.aNode.map(p => `<circle cx="${r3(p.x)}" cy="${r3(p.y)}" r="${r3(sw * 1.6)}"`
                    + ` fill="#ffffff" stroke="#e11d48" stroke-width="${r3(sw * 0.6)}"/>`).join("")
                : "")
            + "</svg>";
    })();

    const { ref: previewRef, zoomBy, resetView } = usePanZoom(preview, fitKey);

    const baseName = `${(file?.name ?? "trace").replace(/\.[^.]+$/, "")}_traced`,
        fileName = (fmt: FormatKey): string => `${baseName}.${FORMATS[fmt].ext}`;

    const download = async (fmt: FormatKey): Promise<void> => {
        if (!result) return;
        setFormat(fmt);
        const blob = fmt === "fds"
            ? await traceToFds(result)
            : fmt === "dxf"
                ? new Blob([traceToDxf(result)], { type: "application/dxf" })
                : new Blob([traceToSvg(result)], { type: "image/svg+xml" });
        downloadBlob(blob, fileName(fmt));
        // Event names as configured in Google Analytics: TRACE_DXF_Download, …
        trackEvent(`TRACE_${fmt.toUpperCase()}_Download`);
    };

    const bCenter = mode === "centerline",
        oMode = MODES.find(o => o.id === mode)!;

    return (
        <div className="mx-auto w-full max-w-3xl">
            <DropZone
                accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
                icon="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M18 6h.008v.008H18V6Zm2.25 12H3.75A1.5 1.5 0 0 1 2.25 16.5v-9A1.5 1.5 0 0 1 3.75 6h16.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5Z"
                label={busy && !image ? "Reading…" : "Drop a PNG, JPEG, GIF, BMP or WebP here"}
                sub="or click to browse — everything runs 100% in your browser"
                busy={busy}
                onFile={openFile}
            />

            {error && (
                <div role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                    {error}
                </div>
            )}

            {image && (
                <div className="glass mt-8 overflow-hidden rounded-2xl">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                        <p className="truncate text-sm text-slate-300">
                            <span className="mr-2 inline-block size-2 rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
                            {file?.name} · {image.sourceWidth}×{image.sourceHeight} px
                        </p>
                        <FormatMenu
                            active={format}
                            label={`Download ${fileName(format)}`}
                            disabled={!result}
                            onDownload={fmt => void download(fmt)}
                        />
                    </div>

                    <div className="p-5">
                        {/* What to trace, and what the result is for */}
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="group" aria-label="What to trace">
                                    {MODES.map(o => (
                                        <button
                                            key={o.id}
                                            aria-pressed={mode === o.id}
                                            title={o.hint}
                                            onClick={() => setMode(o.id)}
                                            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition
                                                ${mode === o.id ? "bg-white/10 text-white ring-1 ring-cyan-400/40" : "text-slate-400 hover:text-slate-200"}`}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>

                                {!bCenter && (
                                    <select
                                        aria-label="What the traced outlines are for"
                                        value={style}
                                        onChange={e => setStyle(e.target.value as TraceStyle)}
                                        title={STYLES.find(o => o.id === style)!.hint}
                                        className={`text-sm ${FIELD_CLASS}`}
                                    >
                                        {STYLES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </select>
                                )}
                            </div>

                            <ul className="flex flex-wrap gap-2" aria-label="Preview colours">
                                {result && (
                                    <li className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                                        <span className="size-2.5 rounded-full" style={{ background: result.operation.css }} aria-hidden="true" />
                                        {result.operation.name}
                                    </li>
                                )}
                            </ul>
                        </div>

                        {/* The trace over the faded source */}
                        <div className="relative">
                            <div
                                ref={previewRef}
                                className="preview-grid h-120 cursor-grab touch-none overflow-hidden rounded-xl ring-1 ring-white/10 select-none"
                                dangerouslySetInnerHTML={{ __html: preview }}
                            />
                            <ZoomControls zoomBy={zoomBy} resetView={resetView} />
                            <PanHint />
                        </div>

                        {result && (
                            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                                {[
                                    { label: "Size", value: `${result.width.toFixed(1)} × ${result.height.toFixed(1)} mm` },
                                    { label: bCenter ? "Lines" : "Paths", value: String(result.paths) },
                                    { label: "Nodes", value: String(result.nodes) },
                                    { label: "Accuracy", value: `± ${result.accuracy.toFixed(3)} mm` }
                                ].map(o => (
                                    <div key={o.label}>
                                        <dt className="text-[11px] tracking-wide text-slate-500 uppercase">{o.label}</dt>
                                        <dd className="text-sm text-slate-200 tabular-nums">{o.value}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}

                        {result?.warnings.map(s => (
                            <p key={s} className="mt-3 text-xs text-amber-300/80">{s}</p>
                        ))}

                        {/* Sliders */}
                        <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 sm:grid-cols-2">
                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <label htmlFor="trace-threshold" className="text-sm font-medium text-white">
                                        {alpha ? "Opacity threshold" : "Threshold"}
                                    </label>
                                    <NumberField
                                        label="Threshold, 0 to 255"
                                        value={threshold}
                                        min={0}
                                        max={255}
                                        unit=""
                                        onChange={setThreshold}
                                    />
                                </div>
                                <input
                                    id="trace-threshold"
                                    type="range"
                                    min={0}
                                    max={255}
                                    step={1}
                                    value={threshold}
                                    onChange={e => setThreshold(parseFloat(e.target.value))}
                                    className="mt-2 w-full accent-cyan-400"
                                />
                                <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                    {alpha
                                        ? "Anything more opaque than this counts as shape."
                                        : "Anything darker than this counts as shape."}{" "}
                                    Watch the faded image underneath and move it until the outline sits where you want it.
                                </span>
                            </div>

                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <label htmlFor="trace-smooth" className="text-sm font-medium text-white">Smooth</label>
                                    <NumberField
                                        label="Smooth, 0 to 1.334"
                                        value={smooth}
                                        min={0}
                                        max={1.334}
                                        unit=""
                                        onChange={setSmooth}
                                    />
                                </div>
                                <input
                                    id="trace-smooth"
                                    type="range"
                                    min={0}
                                    max={1.334}
                                    step={0.01}
                                    value={smooth}
                                    onChange={e => setSmooth(parseFloat(e.target.value))}
                                    className="mt-2 w-full accent-cyan-400"
                                />
                                <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                    How much of a bend may be rounded into a curve instead of kept as a corner. At 0 you get a plain polygon; at 1 a traced circle comes out as curves while a
                                    traced square keeps its four corners.
                                </span>
                            </div>

                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <label htmlFor="trace-optimize" className="text-sm font-medium text-white">Optimize</label>
                                    <NumberField
                                        label="Optimize tolerance in pixels"
                                        value={optimize}
                                        min={0}
                                        max={4}
                                        unit="px"
                                        onChange={setOptimize}
                                    />
                                </div>
                                <input
                                    id="trace-optimize"
                                    type="range"
                                    min={0}
                                    max={4}
                                    step={0.05}
                                    value={optimize}
                                    onChange={e => setOptimize(parseFloat(e.target.value))}
                                    className="mt-2 w-full accent-cyan-400"
                                />
                                <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                    How far a node may be moved to be rid of it. 0 is already clean —
                                    a traced boundary is a staircase, and half a pixel of it is absorbed before this slider
                                    adds anything. The accuracy above is what it actually cost.
                                </span>
                            </div>

                            {bCenter ? (
                                <div>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <label htmlFor="trace-prune" className="text-sm font-medium text-white">Shortest branch</label>
                                        <NumberField
                                            label="Shortest branch in pixels"
                                            value={prune}
                                            min={0}
                                            max={80}
                                            unit="px"
                                            onChange={setPrune}
                                        />
                                    </div>
                                    <input
                                        id="trace-prune"
                                        type="range"
                                        min={0}
                                        max={80}
                                        step={1}
                                        value={prune}
                                        onChange={e => setPrune(parseFloat(e.target.value))}
                                        className="mt-2 w-full accent-cyan-400"
                                    />
                                    <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                        Thinning leaves a little barb wherever the edge of a stroke bulges. Anything
                                        shorter than this is dropped — raise it until the whiskers are gone, then stop,
                                        or real short strokes go with them.
                                    </span>
                                </div>
                            ) : (
                                <div>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <label htmlFor="trace-min" className="text-sm font-medium text-white">Ignore smaller than</label>
                                        <NumberField
                                            label="Ignore shapes smaller than, in pixels"
                                            value={minArea}
                                            min={0}
                                            max={400}
                                            unit="px"
                                            onChange={setMinArea}
                                        />
                                    </div>
                                    <input
                                        id="trace-min"
                                        type="range"
                                        min={0}
                                        max={400}
                                        step={1}
                                        value={minArea}
                                        onChange={e => setMinArea(parseFloat(e.target.value))}
                                        className="mt-2 w-full accent-cyan-400"
                                    />
                                    <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                        Shapes and holes enclosing fewer pixels than this
                                        are left out — which is how JPEG speckle and scanner dust stop becoming hundreds
                                        of tiny cut paths.
                                    </span>
                                </div>
                            )}

                            <label className="block">
                                <span className="text-sm font-medium text-white">Traced width</span>
                                <span className="mt-2 flex">
                                    <NumberField
                                        label="Traced width in millimetres"
                                        value={widthMm ?? Math.round((image.sourceWidth * 25.4 / 96) * 10) / 10}
                                        min={1}
                                        onChange={setWidthMm}
                                        className="w-24"
                                    />
                                </span>
                                <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                    A bitmap carries no physical size, so 96 dpi is assumed on its pixels. Set the width
                                    the result should be cut or engraved at — every millimetre figure above follows it.
                                </span>
                            </label>

                            <div className="space-y-2.5">
                                {[
                                    {
                                        id: "invert",
                                        on: invert,
                                        set: setInvert,
                                        label: "Invert",
                                        hint: "Trace the light side instead — for white artwork on a dark ground."
                                    },
                                    {
                                        id: "alpha",
                                        on: alpha,
                                        set: setAlpha,
                                        label: "Trace transparency",
                                        hint: "Judge by the alpha channel rather than brightness, so a cut-out PNG traces its silhouette whatever colour it is."
                                    },
                                    {
                                        id: "fade",
                                        on: fade,
                                        set: setFade,
                                        label: "Fade the image in",
                                        hint: "Show the source faintly behind the vectors, to check the threshold. Preview only — never exported."
                                    },
                                    {
                                        id: "points",
                                        on: showPoints,
                                        set: setShowPoints,
                                        label: "Show points",
                                        hint: "Mark every node of the traced paths, so Optimize can be judged rather than guessed."
                                    }
                                ].map(o => (
                                    <label key={o.id} className="flex items-start gap-2.5 text-sm text-slate-300" title={o.hint}>
                                        <input
                                            type="checkbox"
                                            checked={o.on}
                                            onChange={e => o.set(e.target.checked)}
                                            className="mt-0.5 size-4 shrink-0 accent-cyan-400"
                                        />
                                        <span>
                                            {o.label}
                                            <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{o.hint}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
                            {oMode.hint} A bitmap has no curves in it, so a trace is always an interpretation: the
                            threshold decides what counts as ink, and the result is accurate to the figure above rather
                            than exactly. Filled outlines export as one even-odd path in surface-engraving blue, cut
                            outlines in red, and a centreline in line-engraving green — reassign the operation in your
                            laser software if you want it otherwise.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
