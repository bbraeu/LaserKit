import { useCallback, useEffect, useRef, useState } from "react";
import { toSVG, toDXF, toFDS, getUsedOperations } from "../lib/convert";
import type { XcsProject } from "../lib/convert";
import type { Operation } from "../lib/dxf";
import { getProjectMeta, getCanvasMeta } from "../lib/meta";
import type { ProjectMeta, CanvasMeta } from "../lib/meta";
import { LASERS, getLaser, detectLaser, convertSetting } from "../lib/lasers";
import { downloadBlob, downloadAsZip, trackEvent } from "../lib/util";
import { isXsArchive, parseXs } from "../lib/xs";
import { usePanZoom, ZoomControls, PanHint } from "./PanZoom";

export const FORMATS = {
    dxf: {
        ext: "dxf",
        label: "DXF",
        note: "default",
        desc: "Universal CAD/CAM format — operations colour-coded (LightBurn, Fusion, …)"
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

type FormatKey = keyof typeof FORMATS;

interface CanvasResult {
    title: string;
    svg: string;
    /** on-screen variant: rasters tinted to their operation colour */
    preview: string;
    dxf: string;
    fds: Blob;
    baseName: string;
    operations: Operation[];
    /** raster images on this canvas — only SVG can carry them (see note below) */
    rasters: number;
    /** material and laser settings, shown below the preview */
    meta: CanvasMeta;
}

interface ConversionState {
    sourceName: string;
    canvases: CanvasResult[];
    excluded: string[];
    meta: ProjectMeta;
}

const fileNameFor = (oCanvas: CanvasResult, fmt: FormatKey): string =>
    `${oCanvas.baseName}_${oCanvas.title.replaceAll(" ", "_")}.${FORMATS[fmt].ext}`;

const blobFor = (oCanvas: CanvasResult, fmt: FormatKey): Blob => {
    switch (fmt) {
        case "fds": return oCanvas.fds;
        case "svg": return new Blob([oCanvas.svg], { type: "image/svg+xml" });
        default: return new Blob([oCanvas.dxf], { type: "application/dxf" });
    }
};

// Of the three outputs only SVG can hold a raster image: DXF's only raster
// entity is a reference to an external file, and an .fds shape is a
// QPainterPath outline. So a canvas containing an image is offered as SVG only,
// rather than handing out a DXF/FDS with the picture silently missing.
const carriesRaster = (fmt: FormatKey): boolean => fmt === "svg";

/** The format to actually export in — falls back to SVG when rasters are involved. */
const usableFormat = (fmt: FormatKey, bHasRaster: boolean): FormatKey =>
    bHasRaster && !carriesRaster(fmt) ? "svg" : fmt;

const withUnit = (n: number | undefined, sUnit: string): string =>
    n === undefined ? "—" : `${n}${sUnit}`;

const SELECT_CLASS = "rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-slate-200 outline-none transition hover:border-cyan-400/50 focus-visible:border-cyan-400/60";

// The machine setup and the laser parameters behind each operation. They cannot
// travel inside a DXF/SVG/FDS file, so they are listed here for re-entering as
// cut settings after the import — optionally converted to another laser module.
function SettingsPanel({ oProject, oCanvas }: { oProject: ProjectMeta; oCanvas: CanvasMeta }) {
    // Seeded from the module the project was saved for, but editable: files older
    // than ~1.5 do not record it, and a project may have been set up on a machine
    // other than the one that saved it.
    const [source, setSource] = useState(() => detectLaser(oProject.sourceWatt, oProject.sourceKind));
    const [target, setTarget] = useState("");

    const oSource = getLaser(source),
        oTarget = getLaser(target),
        bConvert = !!(oSource && oTarget),
        // A different wavelength interacts with the material in a way no amount of
        // arithmetic covers, so it is called out rather than quietly converted.
        bCrossWave = bConvert && oSource!.wavelength !== oTarget!.wavelength;

    const aInfo = ([
        { label: "Machine", value: oProject.device },
        { label: "Laser", value: oProject.power },
        { label: "Material", value: oCanvas.material },
        { label: "Thickness", value: oCanvas.thickness },
        { label: "Focus", value: oCanvas.focalLength },
        { label: "Air assist", value: oCanvas.airAssist },
        { label: "Purifier", value: oCanvas.purifier },
        { label: "Saved with", value: oProject.app },
        { label: "Last modified", value: oProject.modified }
    ] as { label: string; value?: string }[]).filter((o): o is { label: string; value: string } => !!o.value);

    // A project saved without a device carries none of this — skip the empty box.
    if (!aInfo.length && !oCanvas.settings.length) return null;

    return (
        <details className="group mt-4 rounded-xl border border-white/10 bg-white/[0.03]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                <svg className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
                <span className="font-medium text-white">xTool project settings</span>
                <span className="truncate text-xs text-slate-400">
                    {[oProject.device, oProject.power, oCanvas.material, oCanvas.thickness].filter(Boolean).join(" · ")}
                </span>
            </summary>

            <div className="space-y-4 border-t border-white/10 px-4 py-4">
                <div className="flex gap-4">
                    {oProject.cover && (
                        <img src={oProject.cover} alt="Project thumbnail as saved by xTool"
                            className="size-16 shrink-0 rounded-lg bg-white/5 object-contain ring-1 ring-white/10" />
                    )}
                    <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                        {aInfo.map(o => (
                            <div key={o.label}>
                                <dt className="text-[11px] tracking-wide text-slate-500 uppercase">{o.label}</dt>
                                <dd className="truncate text-sm text-slate-200" title={o.value}>{o.value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>

                {oCanvas.settings.length > 0 && (
                    <>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span>Convert from</span>
                            <select aria-label="Laser the project was made for" value={source} className={SELECT_CLASS}
                                onChange={e => setSource(e.target.value)}>
                                <option value="">unknown</option>
                                {LASERS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                            {oProject.sourceAssumed && source && (
                                <span className="text-amber-300/70" title={`${oProject.device} projects do not always store the module wattage — this is the model's stock laser`}>
                                    (assumed for {oProject.device})
                                </span>
                            )}
                            <span>to</span>
                            <select aria-label="Laser to convert the settings for" value={target} className={SELECT_CLASS}
                                onChange={e => {
                                    setTarget(e.target.value);
                                    if (e.target.value) trackEvent("convert_laser");
                                }}>
                                <option value="">— off —</option>
                                {LASERS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-white/10 text-[11px] tracking-wide text-slate-500 uppercase">
                                        <th className="py-2 pr-4 font-medium">Operation</th>
                                        <th className="py-2 pr-4 font-medium">Power</th>
                                        <th className="py-2 pr-4 font-medium">Speed</th>
                                        <th className="py-2 pr-4 font-medium">Passes</th>
                                        <th className="py-2 pr-4 font-medium">Density</th>
                                        <th className="py-2 pr-4 font-medium">Shapes</th>
                                        {bConvert && (
                                            <th className="py-2 font-medium whitespace-nowrap text-cyan-300/80">→ {oTarget!.label}</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {oCanvas.settings.map(o => {
                                        const oNew = bConvert ? convertSetting(o, oSource!, oTarget!) : undefined;
                                        return (
                                            <tr key={`${o.operation.name}|${o.power}|${o.speed}|${o.passes}|${o.density}`}
                                                className="border-b border-white/5 last:border-0">
                                                <td className="py-2 pr-4">
                                                    <span className="flex items-center gap-2 whitespace-nowrap text-slate-200">
                                                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.operation.css }} aria-hidden="true" />
                                                        {o.operation.name}
                                                        {o.preset && (
                                                            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400" title="Values from an xTool material preset">
                                                                preset
                                                            </span>
                                                        )}
                                                    </span>
                                                    {o.notes.length > 0 && (
                                                        <span className="mt-0.5 block pl-4.5 text-[11px] text-slate-500">{o.notes.join(" · ")}</span>
                                                    )}
                                                </td>
                                                <td className="py-2 pr-4 text-slate-300 tabular-nums">{withUnit(o.power, " %")}</td>
                                                <td className="py-2 pr-4 whitespace-nowrap text-slate-300 tabular-nums">{withUnit(o.speed, " mm/s")}</td>
                                                <td className="py-2 pr-4 text-slate-300 tabular-nums">{withUnit(o.passes, "×")}</td>
                                                <td className="py-2 pr-4 text-slate-300 tabular-nums">{withUnit(o.density, "")}</td>
                                                <td className="py-2 pr-4 text-slate-400 tabular-nums">{o.shapes}</td>
                                                {bConvert && (
                                                    <td className="py-2 whitespace-nowrap tabular-nums">
                                                        {oNew ? (
                                                            <span className={oNew.flatOut ? "text-amber-200" : "text-cyan-200"}
                                                                title={oNew.flatOut ? `A ${oTarget!.label} cannot reach the source's power — full power at a lower speed instead` : undefined}>
                                                                {oNew.power} % · {oNew.speed} mm/s{oNew.passes > 1 ? ` · ${oNew.passes}×` : ""}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-500">—</span>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {target && !source && (
                            <p className="text-[11px] text-amber-300/80">
                                This project does not say which laser module the percentages refer to — pick the source
                                laser above to convert them.
                            </p>
                        )}

                        {bConvert && (
                            <p className="text-[11px] leading-relaxed text-slate-500">
                                Converted to keep the energy per millimetre equal: speed is held where the target can
                                supply the power, otherwise it runs at 100 % and slower, adding passes below 2 mm/s
                                (amber). Density and dithering are unchanged. Arithmetic only — lens, spot size and air
                                assist all shift the result, so treat it as the centre of a test grid.
                                {bCrossWave && (
                                    <span className="mt-1 block text-amber-300/80">
                                        {oSource!.wavelength} nm → {oTarget!.wavelength} nm: a different wavelength is
                                        absorbed completely differently — IR will not cut wood, CO₂ will not mark bare
                                        metal. The numbers are a starting point at best.
                                    </span>
                                )}
                            </p>
                        )}
                    </>
                )}

                {oCanvas.precautions.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label="Material precautions">
                        {oCanvas.precautions.map(s => (
                            <li key={s} className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200/90">
                                {s}
                            </li>
                        ))}
                    </ul>
                )}

                {oCanvas.material?.startsWith("Material #") && (
                    <p className="text-[11px] text-slate-500">
                        Current xTool versions store only the catalogue id of the material, not its name — the id is
                        shown as saved.
                    </p>
                )}
            </div>
        </details>
    );
}

export default function Converter() {
    const [state, setState] = useState<ConversionState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [tab, setTab] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const convertFile = useCallback(async (file: File) => {
        setBusy(true);
        setError(null);
        setState(null);
        try {
            // Yield a frame so the busy state paints before the heavy work.
            await new Promise(r => setTimeout(r, 30));

            // .xcs is plain JSON; .xs (xTool Studio) is a ZIP archive holding
            // the same model split into parts — detect by magic bytes, not name.
            const buf = await file.arrayBuffer();
            const oJSON: XcsProject = isXsArchive(buf)
                ? parseXs(buf)
                : JSON.parse(new TextDecoder().decode(buf)) as XcsProject;
            if (!Array.isArray(oJSON.canvas)) {
                throw new Error("not an xcs project");
            }

            const oSvg = toSVG(oJSON),
                oDxf = toDXF(oJSON),
                oFds = await toFDS(oJSON);

            setState({
                sourceName: file.name,
                excluded: [...new Set(oSvg.aExcluded)],
                meta: getProjectMeta(oJSON),
                canvases: oSvg.aCanvas.map((oCanvas, i) => ({
                    title: oCanvas.title,
                    svg: oCanvas.svg,
                    preview: oCanvas.preview,
                    dxf: oDxf.aCanvas[i]!.dxf,
                    fds: oFds.aCanvas[i]!.fds,
                    baseName: file.name.replace(/\.(xcs|xs)$/i, ""),
                    operations: getUsedOperations(oJSON, oJSON.canvas[i]!),
                    rasters: oJSON.canvas[i]!.displays.filter(d => d.type === "BITMAP").length,
                    meta: getCanvasMeta(oJSON, oJSON.canvas[i]!)
                }))
            });
            setTab(0);
            trackEvent("convert_file");
        } catch {
            setError("This does not look like a valid .xcs or .xs file. Please select a project file saved by xTool Creative Space or xTool Studio.");
        } finally {
            setBusy(false);
        }
    }, []);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void convertFile(file);
    }, [convertFile]);

    const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void convertFile(file);
        e.target.value = ""; // allow re-selecting the same file
    }, [convertFile]);

    const [format, setFormat] = useState<FormatKey>("dxf");
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close the format menu on outside click or Escape.
    useEffect(() => {
        if (!menuOpen) return;
        const onDown = (e: PointerEvent): void => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") setMenuOpen(false);
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [menuOpen]);

    const active = state?.canvases[tab];

    // Restrict the offered formats per canvas: only the canvas being previewed
    // decides, so a vector-only canvas in the same project still exports as DXF.
    const activeHasRaster = (active?.rasters ?? 0) > 0,
        activeFormat = usableFormat(format, activeHasRaster),
        // One zip carries every canvas in a single format, so any image in the
        // project restricts the whole archive.
        anyRaster = state?.canvases.some(c => c.rasters > 0) ?? false,
        zipFormat = usableFormat(format, anyRaster);

    const downloadOne = (oCanvas: CanvasResult, fmt: FormatKey) => {
        downloadBlob(blobFor(oCanvas, fmt), fileNameFor(oCanvas, fmt));
        // Event names as configured in Google Analytics: DXF_Download, FDS_Download, SVG_Download
        trackEvent(`${fmt.toUpperCase()}_Download`);
    };

    const downloadAll = () => {
        if (!state) return;
        void downloadAsZip(
            state.canvases.map(c => ({ blob: blobFor(c, zipFormat), file: fileNameFor(c, zipFormat) })),
            state.sourceName.replace(/\.(xcs|xs)$/i, "") + ".zip"
        );
        trackEvent("download_zip");
    };

    // Refit only for a new file or canvas, not for anything else that re-renders.
    const { ref: previewRef, zoomBy, resetView } = usePanZoom(active?.preview, `${state?.sourceName}|${tab}`);

    return (
        <div className="mx-auto w-full max-w-3xl">
            {/* Drop zone */}
            <div
                role="button"
                tabIndex={0}
                aria-label="Select or drop an .xcs or .xs file"
                onClick={() => inputRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 outline-none
                    ${dragOver
                        ? "border-cyan-300 bg-cyan-400/10 scale-[1.02] shadow-[0_0_60px_-12px_rgba(34,211,238,0.6)]"
                        : "border-white/15 bg-white/[0.03] hover:border-cyan-400/60 hover:bg-white/[0.05] focus-visible:border-cyan-400/60"}`}
            >
                <div className="laser-beam" aria-hidden="true" />
                <input ref={inputRef} type="file" accept=".xcs,.xs" className="hidden" onChange={onPick} />

                <div className="pointer-events-none relative z-10 flex flex-col items-center gap-3">
                    <div className="grid size-16 place-items-center rounded-2xl bg-linear-to-br from-cyan-400/20 to-violet-500/20 ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-110">
                        <svg className="size-8 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                        </svg>
                    </div>
                    <p className="text-lg font-semibold text-white">
                        {busy ? "Converting…" : "Drop your .xcs or .xs file here"}
                    </p>
                    <p className="text-sm text-slate-400">
                        {busy ? "flattening curves to 0.01 mm" : "or click to browse — conversion runs 100% in your browser"}
                    </p>
                </div>
            </div>

            {error && (
                <div role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                    {error}
                </div>
            )}

            {state && (
                <div className="glass mt-8 overflow-hidden rounded-2xl">
                    {/* Header: file name + zip download */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                        <p className="truncate text-sm text-slate-300">
                            <span className="mr-2 inline-block size-2 rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
                            {state.sourceName}
                        </p>
                        {state.canvases.length > 1 && (
                            <button
                                onClick={downloadAll}
                                className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400/50 hover:text-white"
                            >
                                Download all as .zip ({FORMATS[zipFormat].label})
                            </button>
                        )}
                    </div>

                    {/* Canvas tabs */}
                    {state.canvases.length > 1 && (
                        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 pt-3">
                            {state.canvases.map((c, i) => (
                                <button
                                    key={c.title}
                                    role="tab"
                                    aria-selected={i === tab}
                                    onClick={() => setTab(i)}
                                    className={`rounded-t-lg px-4 py-2 text-sm font-medium transition
                                        ${i === tab
                                            ? "bg-white/10 text-white shadow-[inset_0_-2px_0_0_var(--color-accent)]"
                                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
                                >
                                    {c.title}
                                </button>
                            ))}
                        </div>
                    )}

                    {active && (
                        <div className="p-5">
                            {/* Legend + download */}
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                <ul className="flex flex-wrap gap-2" aria-label="Operation types in this canvas">
                                    {active.operations.map(op => (
                                        <li key={op.name} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                                            <span className="size-2.5 rounded-full" style={{ background: op.css }} aria-hidden="true" />
                                            {op.name}
                                        </li>
                                    ))}
                                </ul>
                                {/* Split download button: main = current format, arrow = format menu */}
                                <div ref={menuRef} className="relative">
                                    <div className="flex shadow-lg shadow-violet-500/25">
                                        <button
                                            onClick={() => downloadOne(active, activeFormat)}
                                            className="rounded-l-lg bg-linear-to-r from-cyan-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
                                        >
                                            Download {fileNameFor(active, activeFormat)}
                                        </button>
                                        <button
                                            aria-label="Choose download format"
                                            aria-expanded={menuOpen}
                                            aria-haspopup="menu"
                                            onClick={() => setMenuOpen(o => !o)}
                                            className="rounded-r-lg border-l border-white/30 bg-violet-500 px-2.5 text-white transition hover:brightness-110"
                                        >
                                            <svg className={`size-4 transition-transform ${menuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                            </svg>
                                        </button>
                                    </div>

                                    {menuOpen && (
                                        <div role="menu" className="absolute top-full right-0 z-30 mt-2 w-80 rounded-xl bg-slate-900/95 p-1.5 ring-1 ring-white/15 backdrop-blur-xl">
                                            {(Object.keys(FORMATS) as FormatKey[]).map(key => {
                                                // Unavailable for this canvas: it holds an image the format cannot carry.
                                                const bBlocked = activeHasRaster && !carriesRaster(key);
                                                return (
                                                    <button
                                                        key={key}
                                                        role="menuitem"
                                                        disabled={bBlocked}
                                                        aria-disabled={bBlocked}
                                                        title={bBlocked ? "This canvas contains an image, which this format cannot store" : undefined}
                                                        onClick={() => { setFormat(key); setMenuOpen(false); downloadOne(active, key); }}
                                                        className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${bBlocked ? "cursor-not-allowed opacity-40" : "hover:bg-white/10"}`}
                                                    >
                                                        <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${key === activeFormat ? "bg-cyan-400 text-slate-900" : "bg-white/10 text-transparent"}`}>✓</span>
                                                        <span>
                                                            <span className="flex items-center gap-2 text-sm font-semibold text-white">
                                                                {FORMATS[key].label}
                                                                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                                                                    {bBlocked ? "no image support" : FORMATS[key].note}
                                                                </span>
                                                            </span>
                                                            <span className="mt-0.5 block text-xs leading-snug text-slate-400">
                                                                {bBlocked
                                                                    ? "Cannot store the image on this canvas — vector geometry only"
                                                                    : FORMATS[key].desc}
                                                            </span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* SVG preview with pan & zoom */}
                            <div className="relative">
                                <div
                                    ref={previewRef}
                                    className="preview-grid h-120 cursor-grab touch-none overflow-hidden rounded-xl ring-1 ring-white/10 select-none"
                                    dangerouslySetInnerHTML={{ __html: active.preview }}
                                />
                                <ZoomControls zoomBy={zoomBy} resetView={resetView} />
                                <PanHint />
                            </div>

                            {active.rasters > 0 && (
                                <p className="mt-3 text-xs text-amber-300/80">
                                    {active.rasters === 1 ? "This canvas contains an image" : `This canvas contains ${active.rasters} images`}.
                                    DXF and FDS can only store vector geometry, so they are unavailable here — SVG is the
                                    only export that keeps the image.
                                </p>
                            )}

                            {state.excluded.length > 0 && (
                                <p className="mt-3 text-xs text-amber-300/80">
                                    Skipped unsupported shape types: {state.excluded.join(", ")}
                                </p>
                            )}

                            {/* keyed on the file: a new project must re-detect its source laser */}
                            <SettingsPanel key={state.sourceName} oProject={state.meta} oCanvas={active.meta} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
