import { useCallback, useMemo } from "react";
import { Copy, Grid2x2, Ruler } from "lucide-react";
import { readDesignFile } from "../lib/design";
import type { DesignDoc } from "../lib/design";
import { NEST_LIMITS, buildNest, nestToDxf, nestToFds, nestToSvg } from "../lib/nest";
import type { NestMode, NestOptions } from "../lib/nest";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { PairField, SegmentedField, SliderField, ToggleField } from "../workspace/fields";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useDocumentSource } from "../workspace/hooks/useDocumentSource";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Nesting.
//
// The first of the new tools with a file to open, and the only one whose whole
// job is arranging something it did not draw. So the panel is short: the sheet,
// how many, and how far apart. Everything else it needs it reads off the
// design.
//
// The status bar carries the number people actually came for — how many fit —
// and the one they should look at second: how much of the sheet that uses.
// ---------------------------------------------------------------------------

const L = NEST_LIMITS;

interface NestParams extends NestOptions {}

const DEFAULTS: NestParams = {
    mode: "fill",
    copies: 12,
    // A400-ish, which is the bed of the machines this kit is mostly used with.
    sheetWidth: 400,
    sheetHeight: 400,
    gap: 3,
    margin: 5,
    rotate: true
};

const MODES = [
    { id: "fill" as const, label: "Fill the sheet", hint: "As many as go on. The count becomes a readout rather than a setting." },
    { id: "count" as const, label: "A set number", hint: "Exactly this many. If they do not fit on one sheet the tool says how many sheets it would take." }
];

const PRESETS: Preset<NestParams>[] = [
    {
        id: "sheet",
        label: "Fill a 400 mm sheet",
        hint: "As many as fit, 3 mm apart, 5 mm clear of the edge",
        patch: { mode: "fill", sheetWidth: 400, sheetHeight: 400, gap: 3, margin: 5, rotate: true }
    },
    {
        id: "dozen",
        label: "A dozen",
        hint: "Twelve copies, however much sheet that takes",
        patch: { mode: "count", copies: 12 }
    },
    {
        id: "tight",
        label: "Tight pack",
        hint: "1 mm apart and hard against the margin — for a material you are short of",
        patch: { gap: 1, margin: 2, rotate: true }
    },
    {
        id: "a4",
        label: "A4 sheet",
        hint: "210 × 297 mm, the size acrylic and card arrive in",
        patch: { sheetWidth: 210, sheetHeight: 297 }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

export default function NestTool() {
    const params = useHistoryParams<NestParams>(DEFAULTS, { storageKey: "laserkit:params:nest" });
    const p = params.value;

    const read = useCallback(async (file: File) => readDesignFile(file), []);
    const src = useDocumentSource<DesignDoc>({
        read,
        fallbackError: "This file could not be read as a design.",
        event: "NEST_Open",
        acceptHandoff: true
    });

    const input = useMemo(() => ({ doc: src.doc, opt: p }), [src.doc, p]);
    const build = useCallback((o: { doc: DesignDoc | undefined; opt: NestParams }) =>
        (o.doc ? buildNest(o.doc, o.opt) : null), []);

    const { result, error: buildError, fitKey, pending } = useDebouncedBuild({
        input,
        build,
        // The sheet is what the drawing is sized to, so only the sheet refits
        // the view — adding copies fills a frame that has not moved.
        fitKey: [src.tab, src.name, p.sheetWidth, p.sheetHeight].join("|"),
        fallbackError: "This design could not be nested."
    });

    const stem = useMemo(() => `${src.name || "design"}_x${result?.placed ?? 0}`, [src.name, result]);

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "NEST",
        build: fmt => fmt === "fds"
            ? nestToFds(result)
            : textBlob(fmt === "dxf" ? nestToDxf(result) : nestToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = result
        ? result.aLayer.map(l => ({ color: l.operation.css, label: l.operation.name.toLowerCase() }))
        : [];

    return (
        <Workspace
            toolId="nest"
            subject="Sheet"
            subtitle={result ? `${result.placed} × ${mm(result.itemW)} × ${mm(result.itemH)}` : undefined}
            documentName={src.name || "Nesting"}
            from={src.from}
            tabs={(src.aDoc ?? []).map((d, i) => ({ id: String(i), label: d.title }))}
            tab={src.tab}
            onTab={src.setTab}
            empty={src.empty}
            busy={src.busy}
            error={src.error ?? buildError}
            onOpenFile={src.open}
            onClose={src.close}
            params={params}
            stage={{ svg: result?.preview ?? "", fitKey, pending }}
            legend={legend}
            stats={result ? [
                { label: "Copies", value: String(result.placed), hint: "Laid on the sheet. In “fill” this is as many as go on; in “a set number” it is what was asked for, whether or not the sheet holds them." },
                { label: "Grid", value: `${result.columns} × ${result.rows}`, hint: "How many fit across and down. Every copy is the same shape, so rows across a sheet come out as a grid on their own." },
                { label: "Per sheet", value: String(result.perSheet) },
                { label: "Sheets", value: String(result.sheets) },
                { label: "Design", value: `${mm(result.itemW)} × ${mm(result.itemH)}${result.turned ? " (turned)" : ""}` },
                { label: "Sheet used", value: `${Math.round(result.usage * 100)} %`, hint: "How much of the sheet the copies' bounding boxes cover. Not how much material is used — the space inside a design's own outline counts here and is still there afterwards." }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? nestToSvg(result) : ""), disabled: !result }}
            emptyTitle="Drop a design to lay it out"
            emptySub="An SVG, or an xTool .xcs / .xs project — its colours decide what stays engraving and what stays cutting"
            sidebarBlocks={[{
                id: "nest-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── The material ───────────────────────────────────────────── */}
            <PanelSection id="nest-sheet" title="Sheet" icon={<Ruler className="size-3" />}>
                <PairField
                    label="Size"
                    hint="The piece of material you are putting on the bed. Drawn as a dashed guide and never cut — it is where the material is, not something to burn."
                    w={p.sheetWidth}
                    h={p.sheetHeight}
                    min={L.minSheet}
                    onW={n => params.set({ sheetWidth: n }, { label: "Sheet width", coalesce: "sheetWidth" })}
                    onH={n => params.set({ sheetHeight: n }, { label: "Sheet height", coalesce: "sheetHeight" })}
                />
                <SliderField
                    label="Margin"
                    hint="Kept clear all the way round. Two things live in it: whatever holds the sheet down, and the last few millimetres of the bed where the beam is least square."
                    value={p.margin}
                    min={0}
                    max={50}
                    step={0.5}
                    onChange={n => params.set({ margin: n }, { label: "Margin", coalesce: "margin" })}
                />
            </PanelSection>

            {/* ── How many ───────────────────────────────────────────────── */}
            <PanelSection id="nest-copies" title="Copies" icon={<Copy className="size-3" />}>
                <SegmentedField
                    label="Lay out"
                    hint={MODES.find(o => o.id === p.mode)!.hint}
                    value={p.mode}
                    choices={MODES}
                    onChange={(v: NestMode) => params.set({ mode: v }, { label: "Lay out" })}
                />
                {p.mode === "count" && (
                    <SliderField
                        label="How many"
                        value={p.copies}
                        min={1}
                        max={200}
                        step={1}
                        unit=""
                        onChange={n => params.set({ copies: Math.round(n) }, { label: "Copies", coalesce: "copies" })}
                    />
                )}
                <SliderField
                    label="Gap"
                    hint="Unburnt material between one copy and the next. Not decoration: at 0 two cut lines fall on top of each other, the beam goes down the same slot twice and the edge scorches. Two or three millimetres is enough."
                    value={p.gap}
                    min={0}
                    max={30}
                    step={0.5}
                    onChange={n => params.set({ gap: n }, { label: "Gap", coalesce: "gap" })}
                />
                <ToggleField
                    label="Turn if it fits better"
                    hint="Lay the design on its side when more of it fits that way. All the copies turn together or none of them do — they are the same shape, so mixing orientations packs no tighter and only makes the grain run two ways."
                    checked={p.rotate}
                    onChange={b => params.set({ rotate: b }, { label: "Turn to fit" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        <span className="text-muted-foreground">{result.columns} across</span> and{" "}
                        <span className="text-muted-foreground">{result.rows} down</span>
                        {result.turned ? ", laid on its side" : ""}.
                        {result.sheets > 1 && ` That is ${result.sheets} sheets.`}
                    </p>
                )}
            </PanelSection>

            {/* ── What it is doing with them ─────────────────────────────── */}
            <PanelSection id="nest-about" title="Layout" icon={<Grid2x2 className="size-3" />} defaultOpen={false}>
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Copies are packed as <strong className="text-foreground">bounding boxes, in rows</strong>. Real
                    nesting — sliding one outline into the hollow of another — is a solver that runs for minutes and
                    still cannot promise the best answer. Rows are what a person does by hand, they are instant, and
                    for the parts a laser cuts they land within a few per cent of it.
                </p>
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Where rows are a bad fit — a big L, a crescent — it is visible on the canvas rather than hidden in
                    the file. Cut those in two runs, or nest them by hand.
                </p>
                {result && result.aLayer.length > 0 && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        Operations kept:{" "}
                        <span className="text-muted-foreground">
                            {result.aLayer.map(l => l.operation.name.toLowerCase()).join(", ")}
                        </span>.
                    </p>
                )}
            </PanelSection>
        </Workspace>
    );
}
