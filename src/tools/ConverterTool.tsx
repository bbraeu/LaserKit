import { useCallback, useEffect, useMemo, useRef } from "react";
import { Info } from "lucide-react";
import { getUsedOperations, toDXF, toFDS, toSVG } from "../lib/convert";
import type { XcsProject } from "../lib/convert";
import type { Operation } from "../lib/dxf";
import { getCanvasMeta, getProjectMeta } from "../lib/meta";
import type { CanvasMeta, ProjectMeta } from "../lib/meta";
import { detectLaser } from "../lib/lasers";
import { trackEvent, zipBlob } from "../lib/util";
import { isXsArchive, parseXs } from "../lib/xs";
import { PanelSection } from "../workspace/PanelSection";
import { Workspace } from "../workspace/Workspace";
import { ReadoutGrid } from "../workspace/fields";
import { FORMATS, carriesRaster, designExports, textBlob } from "../workspace/formats";
import type { FormatKey } from "../workspace/formats";
import { useDocumentSource } from "../workspace/hooks/useDocumentSource";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";
import { LaserSettings } from "./converter/LaserSettings";

// ---------------------------------------------------------------------------
// xTool project converter.
//
// The only tool with nothing to adjust: an .xcs goes in and three files come
// out, and everything else it shows is a *fact about the file* rather than a
// setting. So its panels divide along exactly that line — the left one carries
// what the project says (machine, material, thickness), the right one carries
// what this canvas is (operations, images, what each format will do with them),
// and the one genuinely interactive part, converting the laser parameters for a
// different module, is a six-column table and lives in the panel under the
// stage where a six-column table fits.
// ---------------------------------------------------------------------------

interface ConvertedCanvas {
    title: string;
    svg: string;
    /** on-screen variant: rasters tinted to their operation colour */
    preview: string;
    dxf: string;
    fds: Blob;
    baseName: string;
    operations: Operation[];
    /** raster images on this canvas — only SVG can carry them */
    rasters: number;
    meta: CanvasMeta;
    /** the same for every canvas of a project; carried along so the panels can read it */
    project: ProjectMeta;
    excluded: string[];
}

interface ConvertParams {
    /** the laser module the project's percentages refer to */
    sourceLaser: string;
    /** the module to convert them for; "" = off */
    targetLaser: string;
}

const DEFAULTS: ConvertParams = { sourceLaser: "", targetLaser: "" };

/** Both belong to the open project, not to the workshop. */
const TRANSIENT: (keyof ConvertParams)[] = ["sourceLaser", "targetLaser"];

/** Read a project and build all three outputs for every canvas in it. */
const readProject = async (file: File): Promise<{ name: string; aDoc: ConvertedCanvas[] }> => {
    // .xcs is plain JSON; .xs (xTool Studio) is a ZIP archive holding the same
    // model split into parts — detected by magic bytes, not by name.
    const buf = await file.arrayBuffer(),
        oJSON: XcsProject = isXsArchive(buf)
            ? parseXs(buf)
            : JSON.parse(new TextDecoder().decode(buf)) as XcsProject;
    if (!Array.isArray(oJSON.canvas)) {
        throw new Error("This does not look like a valid .xcs or .xs file. Please select a project file saved by xTool Creative Space or xTool Studio.");
    }

    const oSvg = toSVG(oJSON),
        oDxf = toDXF(oJSON),
        oFds = await toFDS(oJSON),
        project = getProjectMeta(oJSON),
        excluded = [...new Set(oSvg.aExcluded)],
        baseName = file.name.replace(/\.(xcs|xs)$/i, "");

    return {
        name: baseName,
        aDoc: oSvg.aCanvas.map((oCanvas, i) => ({
            title: oCanvas.title,
            svg: oCanvas.svg,
            preview: oCanvas.preview,
            dxf: oDxf.aCanvas[i]!.dxf,
            fds: oFds.aCanvas[i]!.fds,
            baseName,
            operations: getUsedOperations(oJSON, oJSON.canvas[i]!),
            rasters: oJSON.canvas[i]!.displays.filter(d => d.type === "BITMAP").length,
            meta: getCanvasMeta(oJSON, oJSON.canvas[i]!),
            project,
            excluded
        }))
    };
};

const fileNameFor = (o: ConvertedCanvas, fmt: FormatKey): string =>
    `${o.baseName}_${o.title.replaceAll(" ", "_")}.${FORMATS[fmt].ext}`;

const blobFor = (o: ConvertedCanvas, fmt: FormatKey): Blob =>
    fmt === "fds" ? o.fds : textBlob(fmt === "svg" ? o.svg : o.dxf, fmt);

export default function ConverterTool() {
    const params = useHistoryParams<ConvertParams>(DEFAULTS, {
        storageKey: "laserkit:params:convert",
        transient: TRANSIENT
    });
    const p = params.value;

    const onOpen = params.resetTransient;
    const source = useDocumentSource<ConvertedCanvas>({
        read: readProject,
        fallbackError: "This does not look like a valid .xcs or .xs file. Please select a project file saved by xTool Creative Space or xTool Studio.",
        event: "convert_file",
        onOpen
    });
    const doc = source.doc;

    // Seeded from the module the project was saved for, but editable: files older
    // than ~1.5 do not record it, and a project may have been set up on a machine
    // other than the one that saved it.
    const seededRef = useRef<string | null>(null);
    const { replace } = params;
    useEffect(() => {
        if (!doc || seededRef.current === source.name) return;
        seededRef.current = source.name;
        replace({ sourceLaser: detectLaser(doc.project.sourceWatt, doc.project.sourceKind) });
    }, [doc, source.name, replace]);

    const activeHasRaster = (doc?.rasters ?? 0) > 0,
        // One zip carries every canvas in a single format, so any image in the
        // project restricts the whole archive.
        anyRaster = source.aDoc?.some(c => c.rasters > 0) ?? false;

    const blockedFor = useCallback((fmt: FormatKey): string | undefined =>
        activeHasRaster && !carriesRaster(fmt)
            ? "Cannot store the image on this canvas — vector geometry only"
            : undefined,
    [activeHasRaster]);

    const exports: ExportItem[] = useMemo(() => {
        if (!doc) return [];
        const zipFmt: FormatKey = anyRaster ? "svg" : "dxf",
            all = source.aDoc ?? [];
        return [
            ...designExports({
                stem: fileNameFor(doc, "dxf").replace(/\.dxf$/, ""),
                eventPrefix: "",
                order: ["dxf", "fds", "svg"],
                build: fmt => blobFor(doc, fmt),
                blocked: blockedFor
            }),
            ...(all.length > 1 ? [{
                id: "zip",
                label: `All ${all.length} canvases (.zip)`,
                desc: `Every canvas as ${FORMATS[zipFmt].label}, in one archive${anyRaster ? " — an image in the project restricts the whole zip to SVG" : ""}`,
                filename: `${source.name}.zip`,
                blob: () => zipBlob(all.map(c => ({ blob: blobFor(c, zipFmt), file: fileNameFor(c, zipFmt) }))),
                event: "download_zip",
                group: "extra" as const
            }] : [])
        ];
    }, [doc, source.aDoc, source.name, anyRaster, blockedFor]);

    const legend: LegendItem[] = (doc?.operations ?? []).map(op => ({ color: op.css, label: op.name }));

    const warnings = useMemo(() => {
        const a: string[] = [];
        if (doc?.rasters) {
            a.push(`${doc.rasters === 1 ? "This canvas contains an image" : `This canvas contains ${doc.rasters} images`}. DXF and FDS can only store vector geometry, so they are unavailable here — SVG is the only export that keeps the image.`);
        }
        if (doc?.excluded.length) {
            a.push(`Skipped unsupported shape types: ${doc.excluded.join(", ")}`);
        }
        if (doc?.meta.material?.startsWith("Material #")) {
            a.push("Current xTool versions store only the catalogue id of the material, not its name — the id is shown as saved.");
        }
        return a;
    }, [doc]);

    const projectFacts = useMemo(() => (doc ? ([
        { label: "Machine", value: doc.project.device },
        { label: "Laser", value: doc.project.power },
        { label: "Material", value: doc.meta.material },
        { label: "Thickness", value: doc.meta.thickness },
        { label: "Focus", value: doc.meta.focalLength },
        { label: "Air assist", value: doc.meta.airAssist },
        { label: "Purifier", value: doc.meta.purifier },
        { label: "Saved with", value: doc.project.app },
        { label: "Modified", value: doc.project.modified }
    ] as { label: string; value?: string }[])
        .filter((o): o is { label: string; value: string } => !!o.value) : []), [doc]);

    return (
        <Workspace
            toolId="convert"
            subject="Canvas"
            subtitle={doc?.title}
            documentName={source.name}
            from={source.from}
            tabs={(source.aDoc ?? []).map((o, i) => ({ id: `${i}-${o.title}`, label: o.title }))}
            tab={source.tab}
            onTab={source.setTab}
            empty={source.empty}
            busy={source.busy}
            error={source.error}
            onOpenFile={source.open}
            onClose={source.close}
            params={params}
            stage={{ svg: doc?.preview ?? "", fitKey: `${source.name}|${source.tab}` }}
            legend={legend}
            stats={doc ? [
                { label: "Canvases", value: String(source.aDoc?.length ?? 0) },
                { label: "Operations", value: String(doc.operations.length) },
                ...(doc.rasters ? [{ label: "Images", value: String(doc.rasters) }] : [])
            ] : []}
            warnings={warnings}
            exports={exports}
            sendTo={{
                name: doc ? fileNameFor(doc, "svg").replace(/\.svg$/i, "") : source.name,
                svg: () => doc?.svg ?? "",
                disabled: !doc
            }}
            busyTitle="Converting…"
            busySub="flattening curves to 0.01 mm"
            sidebarBlocks={doc && projectFacts.length ? [{
                id: "project-facts",
                title: "Project info",
                icon: <Info className="size-3" />,
                children: (
                    <div className="space-y-2">
                        {doc.project.cover && (
                            <img
                                src={doc.project.cover}
                                alt="Project thumbnail as saved by xTool"
                                className="h-20 w-full rounded-md bg-panel-2 object-contain ring-1 ring-line"
                            />
                        )}
                        <ReadoutGrid items={projectFacts} />
                    </div>
                )
            }] : undefined}
            bottomPanels={doc && doc.meta.settings.length ? [{
                id: "laser",
                title: "Laser parameters",
                children: (
                    <LaserSettings
                        project={doc.project}
                        canvas={doc.meta}
                        source={p.sourceLaser}
                        target={p.targetLaser}
                        onSource={v => params.set({ sourceLaser: v }, { label: "Source laser" })}
                        onTarget={v => {
                            params.set({ targetLaser: v }, { label: "Target laser" });
                            if (v) trackEvent("convert_laser");
                        }}
                    />
                )
            }] : undefined}
        >
            <PanelSection id="convert-operations" title="Operations">
                {doc?.operations.length ? (
                    <ul className="space-y-1">
                        {doc.operations.map(op => (
                            <li key={op.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="size-2.5 shrink-0 rounded-full" style={{ background: op.css }} aria-hidden="true" />
                                {op.name}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-[11px] text-subtle-foreground">This canvas has no recognised operations.</p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-subtle-foreground">
                    Every export keeps these apart by colour, so power and speed are assigned once per operation in
                    your laser software rather than per shape.
                </p>
            </PanelSection>

            <PanelSection id="convert-formats" title="Export">
                <ul className="space-y-2">
                    {(["dxf", "fds", "svg"] as FormatKey[]).map(fmt => {
                        const sBlocked = blockedFor(fmt);
                        return (
                            <li key={fmt} className="text-[11px] leading-snug">
                                <span className={sBlocked ? "text-subtle-foreground line-through" : "text-muted-foreground"}>
                                    {FORMATS[fmt].label}
                                </span>
                                <span className="mt-0.5 block text-subtle-foreground">{sBlocked ?? FORMATS[fmt].desc}</span>
                            </li>
                        );
                    })}
                </ul>
            </PanelSection>

            {doc && doc.meta.settings.length > 0 && (
                <PanelSection id="convert-params-hint" title="Laser parameters" defaultOpen={false}>
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        Power and speed cannot travel inside a DXF, an SVG or an .fds. This project's own numbers —
                        and what they would be on a different module — are in the{" "}
                        <span className="text-muted-foreground">Laser parameters</span> panel at the bottom.
                    </p>
                </PanelSection>
            )}
        </Workspace>
    );
}
