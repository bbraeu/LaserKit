import { useCallback, useMemo } from "react";
import { LayoutTemplate, MousePointerClick } from "lucide-react";
import {
    BORDER_COLOR, CUT_COLOR, ITEM_COLOR, MUTED_COLOR, buildOutline, hitItem, readOutlineFile
} from "../lib/outline";
import type { ConnectMode, OutlineDoc } from "../lib/outline";
import { Button } from "../components/ui/button";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { WidthField } from "../workspace/WidthField";
import { Workspace } from "../workspace/Workspace";
import { Field, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useDocumentSource } from "../workspace/hooks/useDocumentSource";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Outer contour tracer.
//
// The most-changed tool of the four, because it is the one with a *selection*.
// Picking items used to be a mode you entered from a segmented control floating
// above the preview, with the count and the Select all / Clear buttons in a
// separate cyan strip below it — three places to look for one idea. Selection is
// now a section of the inspector, which is where a design app puts "what is
// selected", and the stage carries only the clicking itself.
// ---------------------------------------------------------------------------

const BORDER_MIN = -25;
const BORDER_MAX = 100;
/** Upper end of the shrink-wrap reach, in mm — raised further if the gaps need it. */
const REACH_MAX = 100;

const CONNECT_MODES = [
    {
        id: "wrap" as const,
        label: "Shrink-wrap",
        hint: "One smooth outline sweeping from item to item, hugging each of them. Reach is how far it bridges — start from the value the gaps ask for."
    },
    {
        id: "bridge" as const,
        label: "Bridges",
        hint: "Each item keeps its own shape, joined by a 4 mm neck along the shortest route, blended in with a 3 mm fillet."
    },
    {
        id: "hull" as const,
        label: "Taut band",
        hint: "The convex hull of the selection: the shape a rubber band would take around it. Exact geometry, no grid involved."
    }
];

interface ContourParams {
    border: number;
    /** pick items by hand instead of tracing all of them */
    pick: boolean;
    /** indices of the picked items */
    sel: number[];
    connect: boolean;
    mode: ConnectMode;
    /** shrink-wrap reach in mm; 0 = whatever the gaps ask for */
    reach: number;
    /** width in mm for an SVG that stated no physical size; 0 = use the guess */
    widthOverride: number;
}

const DEFAULTS: ContourParams = {
    border: 0,
    pick: false,
    sel: [],
    connect: false,
    mode: "wrap",
    reach: 0,
    widthOverride: 0
};

// Settings that belong to the open file rather than to the workshop. The border
// is one of them: 0 mm means "the item's own contour, exactly", which is the
// honest starting point for a design nobody has looked at yet — carrying over
// the 5 mm the last job wanted would quietly change this one's geometry.
const TRANSIENT: (keyof ContourParams)[] = ["border", "pick", "sel", "connect", "reach", "widthOverride"];

const PRESETS: Preset<ContourParams>[] = [
    {
        id: "exact",
        label: "Exact contour",
        hint: "The item's own outermost path, to the 0.01 mm the curves were flattened to",
        patch: { border: 0, connect: false }
    },
    {
        id: "backing",
        label: "Backing plate · 3 mm",
        hint: "A plate that peeks out all round — the usual for gluing a design on top",
        patch: { border: 3, connect: false }
    },
    {
        id: "keychain",
        label: "Joined plate · 5 mm",
        hint: "Wide border, items shrink-wrapped into one piece",
        patch: { border: 5, connect: true, mode: "wrap" }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

export default function ContourTool() {
    const params = useHistoryParams<ContourParams>(DEFAULTS, {
        storageKey: "laserkit:params:contour",
        transient: TRANSIENT
    });
    const p = params.value;

    const onOpen = params.resetTransient;
    const source = useDocumentSource<OutlineDoc>({
        read: readOutlineFile,
        fallbackError: "This file could not be read. Drop an .svg, or an .xcs / .xs project saved by xTool Creative Space or xTool Studio.",
        event: "outline_file",
        acceptHandoff: true,
        onOpen
    });
    const doc = source.doc;

    const build = useCallback((d: OutlineDoc) => buildOutline(d, {
        border: p.border,
        scale: p.widthOverride && d.width > 0 ? p.widthOverride / d.width : 1,
        selection: p.pick ? p.sel : null,
        connect: p.connect ? { mode: p.mode, reach: p.reach || undefined } : null
    }), [p.border, p.widthOverride, p.pick, p.sel, p.connect, p.mode, p.reach]);

    // A new file, canvas or scale is a different drawing — and so is a different
    // border, because the plate it makes is a different size: at 100 mm the cut
    // line is two hands wider than the design inside it, and a view left where it
    // was would have most of it off-screen. Picking an item is *not*, so clicking
    // your way through a selection never moves the view under the cursor.
    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: doc,
        build,
        fitKey: `${source.name}|${source.tab}|${p.widthOverride}|${p.border}`,
        fallbackError: "Tracing failed."
    });

    const iItems = result?.aItem.length ?? 0,
        bMulti = iItems > 1,
        bPick = p.pick && bMulti,
        iTraced = result?.aSelected.length ?? 0,
        bConnected = p.connect && iTraced > 1,
        // Wide gaps need a wide reach, so the slider follows the design rather
        // than capping it at something arbitrary.
        reachMax = Math.max(REACH_MAX, Math.ceil((result?.autoReach ?? 0) * 3));

    const baseName = `${source.name}${source.aDoc && source.aDoc.length > 1 && doc ? "_" + doc.title.replaceAll(" ", "_") : ""}`;

    const onPick = useCallback((pt: { x: number; y: number }) => {
        if (!bPick || !result) return;
        const i = hitItem(result.aItem, pt);
        if (i < 0) return;
        params.set(
            { sel: p.sel.includes(i) ? p.sel.filter(j => j !== i) : [...p.sel, i] },
            { label: "Selection" }
        );
    }, [bPick, result, p.sel, params]);

    const exports: ExportItem[] = useMemo(() => {
        if (!result?.svg) return [];
        return [
            {
                id: "outline",
                label: "SVG",
                note: "cut line",
                desc: "The cut line alone, in cutting red, at true size in millimetres",
                filename: `${baseName}_outline.svg`,
                blob: () => textBlob(result.svg, "svg"),
                event: "OUTLINE_Download",
                group: "design"
            },
            ...(result.svgWithDesign ? [{
                id: "outline-design",
                label: "Outline + design",
                desc: "The cut line in red plus the traced design in black, in one file — for checking the fit before cutting",
                filename: `${baseName}_outline_with_design.svg`,
                blob: () => textBlob(result.svgWithDesign, "svg"),
                event: "OUTLINE_DESIGN_Download",
                group: "extra" as const
            }] : [])
        ];
    }, [result, baseName]);

    const legend: LegendItem[] = [
        { color: ITEM_COLOR, label: "traced" },
        ...(bPick ? [{ color: MUTED_COLOR, label: "left out" }] : []),
        { color: BORDER_COLOR, label: "border" },
        { color: CUT_COLOR, label: "cut line" }
    ];

    return (
        <Workspace
            toolId="contour"
            subject="Cut line"
            subtitle={result?.svg ? `${mm(result.width)} × ${mm(result.height)}` : undefined}
            documentName={source.name}
            from={source.from}
            tabs={(source.aDoc ?? []).map((o, i) => ({ id: `${i}-${o.title}`, label: o.title }))}
            tab={source.tab}
            onTab={i => { source.setTab(i); params.replace({ sel: [], pick: false }); }}
            empty={source.empty}
            busy={source.busy}
            error={source.error ?? error}
            onOpenFile={source.open}
            onClose={source.close}
            params={params}
            stage={{
                svg: result?.preview ?? "",
                fitKey,
                pending,
                picking: bPick,
                onPick: bPick ? onPick : undefined
            }}
            legend={legend}
            stats={result?.svg ? [
                { label: "Cut size", value: `${mm(result.width)} × ${mm(result.height)}` },
                { label: "Cut lines", value: String(result.pieces) },
                {
                    label: "Accuracy",
                    value: result.accuracy ? `± ${result.accuracy.toFixed(3)} mm` : "exact contour",
                    hint: "A plain contour at 0 mm, and a taut band around one, are the geometry itself; anything involving a border or a grid-based connection is computed on a fine grid."
                },
                { label: "Points", value: String(result.points) }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: `${baseName}_outline`, svg: () => result?.svg ?? "", disabled: !result?.svg }}
            sidebarBlocks={[{
                id: "contour-presets",
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
            {/* ── What gets traced ───────────────────────────────────────── */}
            {bMulti && (
                <PanelSection id="contour-selection" title="Selection" icon={<MousePointerClick className="size-3" />}>
                    <SegmentedField
                        value={p.pick ? "some" : "all"}
                        choices={[
                            { id: "all", label: `All (${iItems})` },
                            { id: "some", label: "Pick items" }
                        ]}
                        onChange={v => params.set(
                            // Switching to picking starts empty — the point is to
                            // choose, and one click is quicker than deselecting.
                            v === "some" ? { pick: true, sel: [] } : { pick: false },
                            { label: "What to trace" }
                        )}
                    />

                    {bPick && (
                        <>
                            <Field
                                label="Picked"
                                hint="An item is a ring no other ring contains, so holes and inner detail are never items of their own."
                                control={
                                    <span className="text-xs text-foreground tabular-nums">
                                        {p.sel.length} <span className="text-subtle-foreground">/ {iItems}</span>
                                    </span>
                                }
                            />
                            <p className="pb-1 text-[11px] leading-relaxed text-subtle-foreground">
                                Click the items on the canvas that should be traced together.
                            </p>
                            <div className="flex gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => params.set(
                                        { sel: result ? result.aItem.map((_, i) => i) : [] },
                                        { label: "Select all" }
                                    )}
                                >
                                    Select all
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1"
                                    disabled={!p.sel.length}
                                    onClick={() => params.set({ sel: [] }, { label: "Clear selection" })}
                                >
                                    Clear
                                </Button>
                            </div>
                        </>
                    )}

                    <ToggleField
                        label="Join into one plate"
                        hint="Items that stand apart keep their own cut line until this joins them — or until a border wide enough to close the gaps merges them by itself."
                        checked={p.connect}
                        disabled={iTraced < 2}
                        onChange={b => params.set({ connect: b }, { label: "Join into one plate" })}
                    />
                </PanelSection>
            )}

            {/* ── Geometry ───────────────────────────────────────────────── */}
            <PanelSection id="contour-geometry" title="Geometry">
                <SliderField
                    label="Border"
                    hint="At 0 mm the cut line is each item's own contour, exactly — where every design starts. Raise it to let the plate peek out around the original, and to weld items whose borders meet into one plate. The canvas refits as it grows, so the whole plate stays in view."
                    value={p.border}
                    min={BORDER_MIN}
                    max={BORDER_MAX}
                    onChange={n => params.set({ border: n }, { label: "Border", coalesce: "border" })}
                />

                {bConnected && (
                    <>
                        <SelectField
                            label="Join by"
                            hint={CONNECT_MODES.find(o => o.id === p.mode)!.hint}
                            value={p.mode}
                            choices={CONNECT_MODES}
                            onChange={v => params.set({ mode: v }, { label: "Join method" })}
                        />
                        {p.mode === "wrap" && (
                            <>
                                <SliderField
                                    label="Reach"
                                    hint={`How far the wrap bridges from item to item.${result?.autoReach ? ` The gaps here ask for about ${result.autoReach} mm.` : ""}`}
                                    value={p.reach || result?.autoReach || 0.5}
                                    min={0.5}
                                    max={reachMax}
                                    onChange={n => params.set({ reach: n }, { label: "Reach", coalesce: "reach" })}
                                />
                                {p.reach > 0 && (
                                    <button
                                        onClick={() => params.set({ reach: 0 }, { label: "Automatic reach" })}
                                        className="text-[11px] text-accent/80 underline decoration-accent/40 underline-offset-2 transition-colors hover:text-accent"
                                    >
                                        back to the automatic reach
                                    </button>
                                )}
                            </>
                        )}
                    </>
                )}
            </PanelSection>

            {/* ── What the laser does with it ────────────────────────────── */}
            <PanelSection id="contour-laser" title="Laser" defaultOpen={false}>
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    The export carries the cut lines in real millimetres, in cutting red — one closed path per piece.
                    A cut line is the outermost path of an item, so holes and inner detail are left out: the plate
                    underneath gets covered anyway.
                </p>
            </PanelSection>

            {doc?.assumed && (
                <WidthField
                    value={p.widthOverride}
                    guess={doc.width}
                    because="The border is in real millimetres, so the plate depends on it."
                    onChange={n => params.set({ widthOverride: n }, { label: "Design width", coalesce: "width" })}
                />
            )}
        </Workspace>
    );
}
