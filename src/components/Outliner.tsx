import { useCallback, useEffect, useRef, useState } from "react";
import { buildOutline, hitItem, readOutlineFile, BORDER_COLOR, CUT_COLOR, ITEM_COLOR, MUTED_COLOR } from "../lib/outline";
import type { ConnectMode, OutlineDoc, OutlineResult } from "../lib/outline";
import { downloadBlob, trackEvent } from "../lib/util";
import { DropZone } from "./DropZone";
import { FIELD_CLASS, NumberField } from "./NumberField";
import { usePanZoom, ZoomControls, PanHint } from "./PanZoom";

/** Range of the border, in mm — the slider's ends and what the field accepts. */
const BORDER_MIN = -25;
const BORDER_MAX = 100;

/** Upper end of the shrink-wrap reach, in mm — raised further if the gaps need it. */
const REACH_MAX = 100;

/** Below this much pointer travel a press counts as a click, not a pan. */
const CLICK_SLOP = 4;

const CONNECT_MODES: { id: ConnectMode; label: string; hint: string }[] = [
    {
        id: "wrap",
        label: "Shrink-wrap",
        hint: "One smooth outline sweeping from item to item, hugging each of them. Reach is how far it bridges — start from the value the gaps ask for."
    },
    {
        id: "bridge",
        label: "Bridges",
        hint: "Each item keeps its own shape, joined by a 4 mm neck along the shortest route, blended in with a 3 mm fillet."
    },
    {
        id: "hull",
        label: "Taut band",
        hint: "The convex hull of the selection: the shape a rubber band would take around it. Exact geometry, no grid involved."
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

export default function Outliner() {
    const [name, setName] = useState("");
    const [aDoc, setDocs] = useState<OutlineDoc[] | null>(null);
    const [tab, setTab] = useState(0);
    const [border, setBorder] = useState(0);
    const [width, setWidth] = useState<number | undefined>(undefined);
    const [pick, setPick] = useState(false);
    const [connect, setConnect] = useState(false);
    const [mode, setMode] = useState<ConnectMode>("wrap");
    // undefined = the reach the gaps ask for, which the tracer works out
    const [reach, setReach] = useState<number | undefined>(undefined);
    const [aSel, setSel] = useState<number[]>([]);
    const [result, setResult] = useState<OutlineResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // What the preview is refitted for. Set together with the result rather than
    // derived from the controls: a new width reaches this component a render before
    // the geometry it rescales, and refitting to the outgoing drawing then leaves
    // the incoming one at the wrong zoom.
    const [fitKey, setFitKey] = useState("");

    const openFile = useCallback(async (file: File) => {
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const o = await readOutlineFile(file);
            setName(o.name);
            setDocs(o.aDoc);
            setTab(0);
            setWidth(undefined);
            setPick(false);
            setConnect(false);
            setReach(undefined);
            setSel([]);
            trackEvent("outline_file");
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

    // Re-trace on every change. The short delay keeps dragging the border slider
    // from queueing one offset per pixel of travel.
    useEffect(() => {
        if (!oDoc) return;
        const id = setTimeout(() => {
            try {
                setResult(buildOutline(oDoc, {
                    border,
                    scale: width && oDoc.width > 0 ? width / oDoc.width : 1,
                    selection: pick ? aSel : null,
                    connect: connect ? { mode, reach } : null
                }));
                // Only a new file, canvas or scale is a different drawing — picking
                // an item or nudging the border must leave the view where the user
                // put it.
                setFitKey(`${name}|${tab}|${width ?? ""}`);
                setError(null);
            } catch (e) {
                setResult(null);
                setError(e instanceof Error ? e.message : "Tracing failed.");
            }
        }, 30);
        return () => clearTimeout(id);
    }, [oDoc, border, width, pick, aSel, connect, mode, reach, name, tab]);

    const { ref: previewRef, zoomBy, resetView } = usePanZoom(result?.preview, fitKey);

    // Picking an item: hit-tested against the geometry rather than against the
    // click target, because panning captures the pointer and would retarget it.
    const pressRef = useRef<{ x: number; y: number } | null>(null);

    const onPreviewClick = (e: React.MouseEvent): void => {
        const oPress = pressRef.current;
        if (!pick || !result || result.aItem.length < 2) return;
        if (oPress && (Math.abs(e.clientX - oPress.x) > CLICK_SLOP || Math.abs(e.clientY - oPress.y) > CLICK_SLOP)) {
            return; // that was a pan, not a pick
        }
        const svg = previewRef.current?.querySelector("svg"),
            m = svg?.getScreenCTM();
        if (!svg || !m) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()),
            i = hitItem(result.aItem, { x: p.x, y: p.y });
        if (i < 0) return;
        setSel(a => a.includes(i) ? a.filter(j => j !== i) : [...a, i]);
    };

    const iItems = result?.aItem.length ?? 0,
        bMulti = iItems > 1,
        bPick = pick && bMulti,
        iTraced = result?.aSelected.length ?? 0,
        bConnected = connect && iTraced > 1,
        // Wide gaps need a wide reach, so the slider follows the design rather
        // than capping it at something arbitrary.
        reachMax = Math.max(REACH_MAX, Math.ceil((result?.autoReach ?? 0) * 3));

    const baseName = `${name}${aDoc && aDoc.length > 1 && oDoc ? "_" + oDoc.title.replaceAll(" ", "_") : ""}`,
        fileName = `${baseName}_outline.svg`,
        fileNameBoth = `${baseName}_outline_with_design.svg`;

    const download = (bWithDesign: boolean): void => {
        const sSvg = bWithDesign ? result?.svgWithDesign : result?.svg;
        if (!sSvg) return;
        downloadBlob(new Blob([sSvg], { type: "image/svg+xml" }), bWithDesign ? fileNameBoth : fileName);
        // Event names as configured in Google Analytics: OUTLINE_Download, OUTLINE_DESIGN_Download
        trackEvent(bWithDesign ? "OUTLINE_DESIGN_Download" : "OUTLINE_Download");
    };

    return (
        <div className="mx-auto w-full max-w-3xl">
            <DropZone
                accept=".svg,.xcs,.xs,image/svg+xml"
                icon="M4.5 12a7.5 7.5 0 1 0 15 0 7.5 7.5 0 0 0-15 0Zm3.75 0a3.75 3.75 0 1 0 7.5 0 3.75 3.75 0 0 0-7.5 0Z"
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
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={() => download(false)}
                                disabled={!result?.svg}
                                title={fileName}
                                className="rounded-lg bg-linear-to-r from-cyan-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Download outline
                            </button>
                            <button
                                onClick={() => download(true)}
                                disabled={!result?.svgWithDesign}
                                title={`${fileNameBoth} — the cut line in red plus the traced design in black, in one file`}
                                className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-cyan-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Download outline + design
                            </button>
                        </div>
                    </div>

                    {/* Canvas tabs — an .xcs project can hold several */}
                    {aDoc.length > 1 && (
                        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 pt-3">
                            {aDoc.map((o, i) => (
                                <button
                                    key={o.title}
                                    role="tab"
                                    aria-selected={i === tab}
                                    onClick={() => { setTab(i); setSel([]); setPick(false); }}
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
                        {/* What to trace */}
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            {/* A design with one item has nothing to choose between. */}
                            {bMulti && (
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="group" aria-label="What to trace">
                                        {[
                                            { id: false, label: `All items (${iItems})` },
                                            { id: true, label: "Individual items" }
                                        ].map(o => (
                                            <button
                                                key={String(o.id)}
                                                aria-pressed={pick === o.id}
                                                onClick={() => {
                                                    setPick(o.id);
                                                    // Switching to picking starts empty — the point is to
                                                    // choose, and one click is quicker than deselecting.
                                                    if (o.id) setSel([]);
                                                }}
                                                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition
                                                    ${pick === o.id ? "bg-white/10 text-white ring-1 ring-cyan-400/40" : "text-slate-400 hover:text-slate-200"}`}
                                            >
                                                {o.label}
                                            </button>
                                        ))}
                                    </div>

                                    <label className={`flex items-center gap-2 text-sm ${iTraced > 1 ? "text-slate-300" : "cursor-not-allowed text-slate-500"}`}
                                        title="Join the traced items into a single plate">
                                        <input
                                            type="checkbox"
                                            checked={connect}
                                            disabled={iTraced < 2}
                                            onChange={e => setConnect(e.target.checked)}
                                            className="size-4 accent-cyan-400"
                                        />
                                        connect them
                                    </label>

                                    {connect && iTraced > 1 && (
                                        <select
                                            aria-label="How to connect the items"
                                            value={mode}
                                            onChange={e => setMode(e.target.value as ConnectMode)}
                                            className={`text-sm ${FIELD_CLASS}`}
                                        >
                                            {CONNECT_MODES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                        </select>
                                    )}
                                </div>
                            )}

                            <ul className="flex flex-wrap gap-2" aria-label="Preview colours">
                                {[
                                    { color: ITEM_COLOR, label: "traced" },
                                    ...(bPick ? [{ color: MUTED_COLOR, label: "left out" }] : []),
                                    { color: BORDER_COLOR, label: "border" },
                                    { color: CUT_COLOR, label: "cut line" }
                                ].map(o => (
                                    <li key={o.label} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                                        <span className="size-2.5 rounded-full" style={{ background: o.color }} aria-hidden="true" />
                                        {o.label}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {bPick && (
                            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-2.5 text-xs text-slate-300">
                                <span>
                                    Click the items in the preview that should be traced together —
                                    <strong className="ml-1 text-white">{aSel.length} of {iItems} picked</strong>
                                </span>
                                <span className="ml-auto flex gap-2">
                                    <button onClick={() => setSel(result ? result.aItem.map((_, i) => i) : [])}
                                        className="rounded-md border border-white/15 px-2.5 py-1 transition hover:border-cyan-400/50 hover:text-white">
                                        Select all
                                    </button>
                                    <button onClick={() => setSel([])} disabled={!aSel.length}
                                        className="rounded-md border border-white/15 px-2.5 py-1 transition hover:border-cyan-400/50 hover:text-white disabled:opacity-40">
                                        Clear
                                    </button>
                                </span>
                            </div>
                        )}

                        {/* The design with the cut line drawn on top */}
                        <div className="relative">
                            <div
                                ref={previewRef}
                                onPointerDown={e => { pressRef.current = { x: e.clientX, y: e.clientY }; }}
                                onClick={onPreviewClick}
                                className={`preview-grid h-120 touch-none overflow-hidden rounded-xl ring-1 ring-white/10 select-none ${bPick ? "cursor-pointer" : "cursor-grab"}`}
                                dangerouslySetInnerHTML={{ __html: result?.preview ?? "" }}
                            />
                            <ZoomControls zoomBy={zoomBy} resetView={resetView} />
                            <PanHint />
                        </div>

                        {result && oDoc && (
                            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                                {[
                                    { label: "Cut size", value: result.svg ? `${mm(result.width)} × ${mm(result.height)}` : "—" },
                                    { label: "Cut lines", value: result.svg ? String(result.pieces) : "—" },
                                    {
                                        label: "Accuracy",
                                        value: !result.svg ? "—" : result.accuracy ? `± ${result.accuracy.toFixed(3)} mm` : "exact contour"
                                    },
                                    { label: "Path points", value: result.svg ? String(result.points) : "—" }
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
                                    <label htmlFor="outline-border" className="text-sm font-medium text-white">Border</label>
                                    <NumberField
                                        label="Border in millimetres"
                                        value={border}
                                        min={BORDER_MIN}
                                        max={BORDER_MAX}
                                        onChange={setBorder}
                                    />
                                </div>
                                <input
                                    id="outline-border"
                                    type="range"
                                    min={BORDER_MIN}
                                    max={BORDER_MAX}
                                    step={0.5}
                                    value={border}
                                    onChange={e => setBorder(parseFloat(e.target.value))}
                                    className="mt-2 w-full accent-cyan-400"
                                />
                                <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                    At 0 mm the cut line is each item's own contour, exactly. Raise it to let the plate peek
                                    out around the original — and to weld items whose borders meet into one plate. Slider or
                                    field, whichever you prefer.
                                </span>
                            </div>

                            {bConnected && (
                                <div>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <label htmlFor="outline-reach" className="text-sm font-medium text-white">
                                            {mode === "wrap" ? "Reach" : "Connection"}
                                        </label>
                                        {mode === "wrap" && (
                                            <NumberField
                                                label="Shrink-wrap reach in millimetres"
                                                value={reach ?? result?.autoReach ?? 0}
                                                min={0.5}
                                                max={reachMax}
                                                onChange={setReach}
                                            />
                                        )}
                                    </div>
                                    {mode === "wrap" && (
                                        <input
                                            id="outline-reach"
                                            type="range"
                                            min={0.5}
                                            max={reachMax}
                                            step={0.5}
                                            value={reach ?? result?.autoReach ?? 0.5}
                                            onChange={e => setReach(parseFloat(e.target.value))}
                                            className="mt-2 w-full accent-cyan-400"
                                        />
                                    )}
                                    <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                        {CONNECT_MODES.find(o => o.id === mode)!.hint}
                                        {mode === "wrap" && result?.autoReach
                                            ? ` The gaps here ask for about ${result.autoReach} mm.`
                                            : ""}
                                    </span>
                                    {mode === "wrap" && reach !== undefined && (
                                        <button onClick={() => setReach(undefined)}
                                            className="mt-1 text-[11px] text-cyan-300/80 underline decoration-cyan-400/40 underline-offset-2 hover:text-cyan-200">
                                            back to the automatic reach
                                        </button>
                                    )}
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
                                        design should be cut at.
                                    </span>
                                </label>
                            )}
                        </div>

                        <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
                            A cut line is the outermost path of an item — holes and inner detail are left out, since the
                            plate underneath gets covered anyway. Items that stand apart keep their own cut line until
                            "connect them" joins them, or a border wide enough to close the gaps merges them by itself.
                            Whenever a border or a grid-based connection is involved the shape is computed on a fine grid,
                            hence the accuracy shown; a plain contour at 0 mm, and a taut band around one, are the geometry
                            itself. The export carries the cut lines in real millimetres, in cutting red.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
