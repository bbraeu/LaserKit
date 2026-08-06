import { useCallback, useEffect, useState } from "react";
import {
    buildInvert, invertToDxf, invertToFds, invertToSvg, readInvertFile
} from "../lib/invert";
import type { FrameShape, InvertResult, MirrorAxis } from "../lib/invert";
import type { DesignDoc } from "../lib/design";
import { downloadBlob, trackEvent } from "../lib/util";
import { DropZone } from "./DropZone";
import { FIELD_CLASS, NumberField } from "./NumberField";
import { FORMATS, FormatMenu } from "./FormatMenu";
import type { FormatKey } from "./FormatMenu";
import { usePanZoom, ZoomControls, PanHint } from "./PanZoom";

/** Range of the plate margin, in mm. */
const MARGIN_MAX = 60;

/** Range of the corner radius, in mm. */
const RADIUS_MAX = 40;

const FRAMES: { id: FrameShape; label: string; hint: string }[] = [
    {
        id: "rect",
        label: "Rectangle",
        hint: "The design's bounding box grown by the margin. Round the corners to match a stamp mount."
    },
    {
        id: "ellipse",
        label: "Ellipse",
        hint: "An ellipse of the design's own proportions, passing through the corners of its bounding box — so a wide design gets a wide oval."
    },
    {
        id: "circle",
        label: "Circle",
        hint: "A circle reaching the far corner of the design's bounding box. What a round stamp needs."
    }
];

const MIRRORS: { id: MirrorAxis; label: string }[] = [
    { id: "none", label: "As drawn" },
    { id: "h", label: "Mirror ↔" },
    { id: "v", label: "Mirror ↕" }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

export default function Inverter() {
    const [name, setName] = useState("");
    const [aDoc, setDocs] = useState<DesignDoc[] | null>(null);
    const [tab, setTab] = useState(0);
    const [frame, setFrame] = useState<FrameShape>("rect");
    const [margin, setMargin] = useState(3);
    const [radius, setRadius] = useState(0);
    const [mirror, setMirror] = useState<MirrorAxis>("none");
    const [cut, setCut] = useState(false);
    const [width, setWidth] = useState<number | undefined>(undefined);
    const [format, setFormat] = useState<FormatKey>("svg");
    const [result, setResult] = useState<InvertResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // What the preview is refitted for. Set together with the result rather than
    // derived from the controls: the controls change a render earlier than the
    // drawing they produce, and refitting to the outgoing drawing then leaves the
    // incoming one at the wrong zoom.
    const [fitKey, setFitKey] = useState("");

    const openFile = useCallback(async (file: File) => {
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const o = await readInvertFile(file);
            setName(o.name);
            setDocs(o.aDoc);
            setTab(0);
            setWidth(undefined);
            trackEvent("invert_file");
        } catch (e) {
            setDocs(null);
            setError(e instanceof Error && e.message.length < 300
                ? e.message
                : "This file could not be read. Drop an .svg, or an .xcs / .xs project saved by xTool Creative Space or xTool Studio.");
        } finally {
            setBusy(false);
        }
    }, []);

    const oDoc = aDoc?.[tab];

    // Re-invert on every change. The short delay keeps dragging a slider from
    // queueing one full rebuild per pixel of travel.
    useEffect(() => {
        if (!oDoc) return;
        const id = setTimeout(() => {
            try {
                setResult(buildInvert(oDoc, {
                    frame,
                    margin,
                    radius,
                    mirror,
                    cut,
                    scale: width && oDoc.width > 0 ? width / oDoc.width : 1
                }));
                // A new file, canvas, scale or plate shape is a different drawing,
                // and a very different size — a circle around a wide design is more
                // than twice as tall as the rectangle was. The margin deliberately
                // does not appear here: nudging it must leave the view alone.
                setFitKey(`${name}|${tab}|${width ?? ""}|${frame}`);
                setError(null);
            } catch (e) {
                setResult(null);
                setError(e instanceof Error ? e.message : "Inverting failed.");
            }
        }, 30);
        return () => clearTimeout(id);
    }, [oDoc, frame, margin, radius, mirror, cut, width, name, tab]);

    const { ref: previewRef, zoomBy, resetView } = usePanZoom(result?.preview, fitKey);

    const baseName = `${name}${aDoc && aDoc.length > 1 && oDoc ? "_" + oDoc.title.replaceAll(" ", "_") : ""}_inverted`,
        fileName = (fmt: FormatKey): string => `${baseName}.${FORMATS[fmt].ext}`;

    const download = async (fmt: FormatKey): Promise<void> => {
        if (!result) return;
        setFormat(fmt);
        const blob = fmt === "fds"
            ? await invertToFds(result)
            : fmt === "dxf"
                ? new Blob([invertToDxf(result)], { type: "application/dxf" })
                : new Blob([invertToSvg(result)], { type: "image/svg+xml" });
        downloadBlob(blob, fileName(fmt));
        // Event names as configured in Google Analytics: INVERT_DXF_Download, …
        trackEvent(`INVERT_${fmt.toUpperCase()}_Download`);
    };

    const oFrame = FRAMES.find(o => o.id === frame)!;

    return (
        <div className="mx-auto w-full max-w-3xl">
            <DropZone
                accept=".svg,.xcs,.xs,image/svg+xml"
                icon="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-9v18"
                label={busy && !aDoc ? "Reading…" : "Drop an .svg, .xcs or .xs file here"}
                sub="or click to browse — everything runs 100% in your browser"
                busy={busy}
                onFile={file => void openFile(file)}
            />

            {error && (
                <div role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                    {error}
                </div>
            )}

            {aDoc && (
                <div className="glass mt-8 overflow-hidden rounded-2xl">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                        <p className="truncate text-sm text-slate-300">
                            <span className="mr-2 inline-block size-2 rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
                            {name}
                        </p>
                        <FormatMenu
                            active={format}
                            label={`Download ${fileName(format)}`}
                            disabled={!result}
                            onDownload={fmt => void download(fmt)}
                        />
                    </div>

                    {/* Canvas tabs — an .xcs project can hold several */}
                    {aDoc.length > 1 && (
                        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 pt-3">
                            {aDoc.map((o, i) => (
                                <button
                                    key={o.title}
                                    role="tab"
                                    aria-selected={i === tab}
                                    onClick={() => setTab(i)}
                                    className={`rounded-t-lg px-4 py-2 text-sm font-medium transition
                                        ${i === tab
                                            ? "bg-white/10 text-white shadow-[inset_0_-2px_0_0_var(--color-accent)]"
                                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
                                >
                                    {o.title}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="p-5">
                        {/* Plate shape, mirroring and the legend */}
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="group" aria-label="Plate shape">
                                    {FRAMES.map(o => (
                                        <button
                                            key={o.id}
                                            aria-pressed={frame === o.id}
                                            title={o.hint}
                                            onClick={() => setFrame(o.id)}
                                            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition
                                                ${frame === o.id ? "bg-white/10 text-white ring-1 ring-cyan-400/40" : "text-slate-400 hover:text-slate-200"}`}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>

                                <select
                                    aria-label="Mirror the design"
                                    value={mirror}
                                    onChange={e => setMirror(e.target.value as MirrorAxis)}
                                    title="A stamp prints back-to-front, so it has to be engraved mirrored"
                                    className={`text-sm ${FIELD_CLASS}`}
                                >
                                    {MIRRORS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                </select>
                            </div>

                            <ul className="flex flex-wrap gap-2" aria-label="Preview colours">
                                {[
                                    { color: "#1e6bff", label: "engraved away" },
                                    { color: "#ffffff", label: "left standing" },
                                    ...(cut ? [{ color: "#ff0000", label: "cut line" }] : [])
                                ].map(o => (
                                    <li key={o.label} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                                        <span className="size-2.5 rounded-full ring-1 ring-white/20" style={{ background: o.color }} aria-hidden="true" />
                                        {o.label}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* The inverted design */}
                        <div className="relative">
                            <div
                                ref={previewRef}
                                className="preview-grid h-120 cursor-grab touch-none overflow-hidden rounded-xl ring-1 ring-white/10 select-none"
                                dangerouslySetInnerHTML={{ __html: result?.preview ?? "" }}
                            />
                            <ZoomControls zoomBy={zoomBy} resetView={resetView} />
                            <PanHint />
                        </div>

                        {result && (
                            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                                {[
                                    { label: "Plate size", value: `${mm(result.width)} × ${mm(result.height)}` },
                                    { label: "Shapes kept", value: String(result.shapes) },
                                    { label: "Engraved area", value: `${Math.round(result.engraved * 100)} %` },
                                    { label: "Path points", value: String(result.points) }
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

                        {/* Controls */}
                        <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 sm:grid-cols-2">
                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <label htmlFor="invert-margin" className="text-sm font-medium text-white">Margin</label>
                                    <NumberField
                                        label="Margin in millimetres"
                                        value={margin}
                                        min={0}
                                        max={MARGIN_MAX}
                                        onChange={setMargin}
                                    />
                                </div>
                                <input
                                    id="invert-margin"
                                    type="range"
                                    min={0}
                                    max={MARGIN_MAX}
                                    step={0.5}
                                    value={margin}
                                    onChange={e => setMargin(parseFloat(e.target.value))}
                                    className="mt-2 w-full accent-cyan-400"
                                />
                                <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                    How much plate stands around the design. {oFrame.hint}
                                </span>
                            </div>

                            {frame === "rect" && (
                                <div>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <label htmlFor="invert-radius" className="text-sm font-medium text-white">Corner radius</label>
                                        <NumberField
                                            label="Corner radius in millimetres"
                                            value={radius}
                                            min={0}
                                            max={RADIUS_MAX}
                                            onChange={setRadius}
                                        />
                                    </div>
                                    <input
                                        id="invert-radius"
                                        type="range"
                                        min={0}
                                        max={RADIUS_MAX}
                                        step={0.5}
                                        value={radius}
                                        onChange={e => setRadius(parseFloat(e.target.value))}
                                        className="mt-2 w-full accent-cyan-400"
                                    />
                                    <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                        Rounded corners are capped at half the shorter side, and they bite into the
                                        margin — if a shape ends up outside the plate, give it more room.
                                    </span>
                                </div>
                            )}

                            {oDoc?.assumed && (
                                <label className="block">
                                    <span className="text-sm font-medium text-white">Design width</span>
                                    <span className="mt-2 flex">
                                        <NumberField
                                            label="Design width in millimetres"
                                            value={width ?? Math.round(oDoc.width * 10) / 10}
                                            min={1}
                                            onChange={setWidth}
                                            className="w-24"
                                        />
                                    </span>
                                    <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                        This SVG carries no physical size, so 96 dpi was assumed. Set the width the whole
                                        design should end up at — the margin is in real millimetres, so it depends on this.
                                    </span>
                                </label>
                            )}

                            <label className="flex items-start gap-2.5 text-sm text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={cut}
                                    onChange={e => setCut(e.target.checked)}
                                    className="mt-0.5 size-4 accent-cyan-400"
                                />
                                <span>
                                    Cut the plate out
                                    <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                        Adds the plate's edge a second time, in cutting red, so the same file both
                                        engraves the background and frees the piece from the sheet.
                                    </span>
                                </span>
                            </label>
                        </div>

                        <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
                            Inverting is exact geometry, not a re-traced picture: the plate is one more ring around the
                            design, and nesting does the rest — a shape becomes a hole, the counter of an "o" becomes
                            solid again. Which means fill is read the way the design itself renders it (even-odd), so
                            overlapping filled shapes want to be merged into one first. The DXF carries every ring as a
                            closed contour in surface-engraving blue and leaves the alternation to your laser software,
                            which is exactly how it fills nested contours anyway; the .fds arrives with the engrave layer
                            already assigned.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
