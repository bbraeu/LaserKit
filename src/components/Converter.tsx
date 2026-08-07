import { useState } from "react";
import { toSVG, toDXF, toFDS, getUsedOperations } from "../lib/convert";
import type { XcsProject } from "../lib/convert";
import type { Operation } from "../lib/dxf";
import { getProjectMeta, getCanvasMeta } from "../lib/meta";
import type { ProjectMeta, CanvasMeta } from "../lib/meta";
import { LASERS, getLaser, detectLaser, convertSetting } from "../lib/lasers";
import { downloadBlob, downloadAsZip, trackEvent } from "../lib/util";
import { isXsArchive, parseXs } from "../lib/xs";
import { DropZone } from "./DropZone";
import { DownloadIcon, FORMATS, FormatMenu } from "./FormatMenu";
import { FIELD_CLASS } from "./NumberField";
import type { FormatKey } from "./FormatMenu";
import { usePanZoom, ZoomControls, PanHint } from "./PanZoom";
import { SendTo } from "./SendTo";

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
                            <select aria-label="Laser the project was made for" value={source} className={FIELD_CLASS}
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
                            <select aria-label="Laser to convert the settings for" value={target} className={FIELD_CLASS}
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
    const [tab, setTab] = useState(0);
    const [format, setFormat] = useState<FormatKey>("dxf");

    const convertFile = async (file: File): Promise<void> => {
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
    };

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
            <DropZone
                accept=".xcs,.xs"
                icon="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                label="Drop your .xcs or .xs file here"
                sub="or click to browse — conversion runs 100% in your browser"
                busy={busy}
                busyLabel="Converting…"
                busySub="flattening curves to 0.01 mm"
                onFile={file => void convertFile(file)}
            />

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
                                className="flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400/50 hover:text-white"
                            >
                                <DownloadIcon />
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
                                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                                    <FormatMenu
                                        active={activeFormat}
                                        label={`Download .${FORMATS[activeFormat].ext}`}
                                        title={`Saves ${fileNameFor(active, activeFormat)}`}
                                        onDownload={fmt => { setFormat(fmt); downloadOne(active, fmt); }}
                                        blocked={fmt => activeHasRaster && !carriesRaster(fmt)
                                            ? "Cannot store the image on this canvas — vector geometry only"
                                            : undefined}
                                        blockedNote="no image support"
                                    />
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

                            {/* Straight under the workbench: this canvas, into the tool
                                that works on it next */}
                            <SendTo
                                from="convert"
                                name={fileNameFor(active, "svg").replace(/\.svg$/i, "")}
                                svg={() => active.svg}
                            />

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
