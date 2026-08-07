import { useCallback, useMemo, useState } from "react";
import { Box as BoxIcon, Columns3, Layers3, Ruler, Tag } from "lucide-react";
import { BOX_LIMITS, boxToDxf, boxToFds, boxToSvg, buildBox } from "../lib/box";
import type { BoxOptions, DimMode, LidType, PanelJoint } from "../lib/box";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Box generator.
//
// The second tool with no file to open — the document is the three numbers at
// the top of the panel — and the first where what you see on the stage is not
// the thing you are making. It is the thing flat: eleven panels nested on a
// sheet, which become a box only after they are cut.
//
// So the panel is ordered the way the box is decided, not the way it is drawn:
//
//   Size      — how big, and whether that is measured inside or outside
//   Material  — the sheet, and the two numbers that decide whether it fits
//               together: the kerf and the gap you want on top of it
//   Joints    — how wide the fingers are, and where the bottom meets the walls
//   Lid       — the one question with five real answers
//   Dividers  — what goes inside it
//   Sheet     — how the parts are nested for cutting
//
// The parts list is a second *reading* of the same drawing rather than a second
// drawing, so it is a tab under the stage with the assembly notes in it, and
// the names on the canvas are a view toggle beside the grid.
// ---------------------------------------------------------------------------

const L = BOX_LIMITS;

/** Big enough for any laser bed; the generator itself clamps far higher. */
const SIZE_MAX = 600;

interface BoxParams extends BoxOptions {}

const DEFAULTS: BoxParams = {
    // Outer, because a box is nearly always something that has to fit *into*
    // a shelf or a drawer. Anyone sizing it around its contents says so.
    dims: "outer",
    width: 120,
    depth: 90,
    height: 60,
    thickness: 3,
    // A diode laser takes about this much out of 3 mm ply. It is the one
    // default here that is a guess about someone's machine, so the hint says
    // how to measure it rather than pretending the number is universal.
    kerf: 0.15,
    clearance: 0,
    finger: 0,
    lid: "none",
    panelJoint: "edge",
    panelOffset: 6,
    lidClearance: 0.1,
    lidLip: true,
    lidHeight: 25,
    pin: 3,
    hingeOffset: 3,
    dividersW: 0,
    dividersD: 0,
    dividerHeight: 0,
    sheetWidth: 400,
    gap: 4,
    labels: true
};

const DIMS = [
    { id: "outer" as const, label: "Outside", hint: "The size the finished box takes up — what a shelf or a drawer has to hold." },
    { id: "inner" as const, label: "Inside", hint: "The clear space in it. The walls and the floor are added on top, so the box comes out bigger than the numbers by a sheet thickness on every side." }
];

const LIDS = [
    { id: "none" as const, label: "No lid — open box", hint: "Four walls and a floor. A tray, a drawer insert, a planter." },
    { id: "layon" as const, label: "Lay-on lid", hint: "A plate the size of the box that rests on the rim, with a lip glued under it so it cannot slide off." },
    { id: "tray" as const, label: "Tray lid (slips over)", hint: "A shallow open box that goes over the outside of this one, the way a shoe box does." },
    { id: "hinged" as const, label: "Hinged lid", hint: "A clamshell: the box and its lid are two halves of the same outline, joined by a pin through a pair of ears." },
    { id: "finger" as const, label: "Closed — finger-jointed", hint: "A sixth panel jointed on like the floor. It never opens again, which is what an enclosure wants." }
];

const JOINTS = [
    { id: "edge" as const, label: "At the edge", hint: "The floor sits in the very bottom of the walls and its edge is part of the outside. The usual box." },
    { id: "offset" as const, label: "Inset", hint: "The floor is raised, and passes through the walls on visible through-tenons. The walls carry on below it as a plinth — feet, or somewhere to hide a cable." }
];

const PRESETS: Preset<BoxParams>[] = [
    {
        id: "open",
        label: "Open storage box",
        hint: "Four walls and a floor, jointed at the edge",
        patch: { lid: "none", panelJoint: "edge", dividersW: 0, dividersD: 0 }
    },
    {
        id: "lidded",
        label: "Box with a lid",
        hint: "A lay-on lid with a lip, 0.1 mm of play",
        patch: { lid: "layon", lidLip: true, lidClearance: 0.1 }
    },
    {
        id: "case",
        label: "Hinged case",
        hint: "A clamshell on a 3 mm pin",
        patch: { lid: "hinged", lidHeight: 25, pin: 3 }
    },
    {
        id: "sorter",
        label: "Parts sorter",
        hint: "Open, with a 3 × 2 grid of compartments",
        patch: { lid: "none", dividersW: 2, dividersD: 1 }
    },
    {
        id: "plinth",
        label: "Enclosure on a plinth",
        hint: "Closed all round, floor inset 8 mm off the ground",
        patch: { lid: "finger", panelJoint: "offset", panelOffset: 8 }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;
const xyz = (o: { w: number; d: number; h: number }): string => `${o.w.toFixed(1)} × ${o.d.toFixed(1)} × ${o.h.toFixed(1)} mm`;

export default function BoxTool() {
    const params = useHistoryParams<BoxParams>(DEFAULTS, { storageKey: "laserkit:params:box" });
    const p = params.value;

    // Naming the parts changes what the canvas *says*, never what is cut, so it
    // is a view toggle beside the grid rather than a property in the panel —
    // and it stays out of the undo history for the same reason.
    const [labels, setLabels] = useState(true);

    const input = useMemo(() => ({ ...p, labels }), [p, labels]);
    const build = useCallback((o: BoxParams) => buildBox(o), []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input,
        build,
        // Everything that changes how the sheet is *nested* refits the view;
        // the kerf, the fit and the labels do not move a single panel.
        fitKey: [
            p.dims, p.width, p.depth, p.height, p.thickness, p.finger, p.lid,
            p.panelJoint, p.panelOffset, p.lidHeight, p.lidLip, p.dividersW,
            p.dividersD, p.sheetWidth, p.gap
        ].join("|"),
        fallbackError: "This box could not be worked out."
    });

    const stem = useMemo(
        () => `box_${Math.round(p.width)}x${Math.round(p.depth)}x${Math.round(p.height)}_${String(p.thickness).replace(".", "-")}mm`,
        [p.width, p.depth, p.height, p.thickness]
    );

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "BOX",
        build: fmt => fmt === "fds"
            ? boxToFds(result)
            : textBlob(fmt === "dxf" ? boxToDxf(result) : boxToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = [
        { color: "#ff0000", label: "cut" },
        ...(result?.aLayer.some(l => l.operation.name === "Line Engraving")
            ? [{ color: "#00a000", label: "glue position" }]
            : [])
    ];

    const bTallLid = p.lid === "tray" || p.lid === "hinged",
        bPlay = p.lid === "layon" || p.lid === "tray" || p.dividersW + p.dividersD > 0,
        innerH = result?.inner.h ?? 0,
        // A divider stands in the open half, which on a clamshell is not the
        // same as the room inside the closed box.
        wellH = result?.wellDepth ?? 0;

    return (
        <Workspace
            toolId="box"
            subject="Box"
            subtitle={result ? xyz(result.outer) : undefined}
            documentName={result ? xyz(result.outer) : "Box"}
            from={null}
            tabs={[]}
            tab={0}
            onTab={() => undefined}
            // There is always a box: the numbers cannot be empty the way a
            // canvas with no file on it is.
            empty={false}
            inspectorEmpty={false}
            openable={false}
            busy={false}
            error={error}
            onOpenFile={() => undefined}
            onClose={() => undefined}
            params={params}
            stage={{ svg: result?.preview ?? "", fitKey, pending }}
            stageToggles={[{
                id: "labels",
                label: "Part names",
                icon: <Tag className="size-3.5" />,
                on: labels,
                onToggle: () => setLabels(b => !b)
            }]}
            legend={legend}
            stats={result ? [
                { label: "Outside", value: xyz(result.outer) },
                { label: "Inside", value: xyz(result.inner), hint: "The clear space left once the walls, the floor and any lid are in place." },
                { label: "Parts", value: String(result.aPart.length) },
                { label: "Sheet", value: `${result.width.toFixed(0)} × ${result.height.toFixed(0)} mm` },
                { label: "Cut", value: `${(result.cutLength / 1000).toFixed(2)} m`, hint: "How far the head travels with the beam on — a rough guide to how long the job takes." },
                { label: "Fingers", value: mm(result.finger), hint: "The width each joint's teeth came out at. Every edge divides into an odd number of them, so the count is close to but rarely exactly this." }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? boxToSvg(result) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "box-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
            bottomPanels={result ? [{
                id: "parts",
                title: `Parts (${result.aPart.length})`,
                children: (
                    <div className="space-y-3">
                        <p className="text-[11px] leading-relaxed text-subtle-foreground">
                            Everything on the sheet, in the order it goes together: the floor first, then the walls
                            round it. Opposite walls are the same part twice — cut both, and flip one over.
                        </p>
                        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                            {result.aPart.map((o, i) => (
                                <li key={`${o.label}-${i}`} className="rounded-md bg-panel-2 px-2.5 py-2 text-[11px] leading-snug">
                                    <span className="font-medium text-foreground">{o.label}</span>
                                    <span className="mt-0.5 block text-subtle-foreground">{o.note}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )
            }] : undefined}
        >
            {/* ── How big ────────────────────────────────────────────────── */}
            <PanelSection id="box-size" title="Size" icon={<BoxIcon className="size-3" />}>
                <SegmentedField
                    label="Measured"
                    hint={DIMS.find(o => o.id === p.dims)!.hint}
                    value={p.dims}
                    choices={DIMS}
                    onChange={(v: DimMode) => params.set({ dims: v }, { label: "Measured from" })}
                />
                <SliderField
                    label="Width"
                    hint="Left to right, across the front."
                    value={p.width}
                    min={L.minSize}
                    max={SIZE_MAX}
                    onChange={n => params.set({ width: n }, { label: "Width", coalesce: "width" })}
                />
                <SliderField
                    label="Depth"
                    hint="Front to back."
                    value={p.depth}
                    min={L.minSize}
                    max={SIZE_MAX}
                    onChange={n => params.set({ depth: n }, { label: "Depth", coalesce: "depth" })}
                />
                <SliderField
                    label="Height"
                    hint={p.dims === "inner"
                        ? "The clear height inside. The floor — and a lid, if the box has one that closes it — is added below and above it."
                        : "Floor to rim, or floor to lid on a box that closes."}
                    value={p.height}
                    min={L.minSize}
                    max={SIZE_MAX}
                    onChange={n => params.set({ height: n }, { label: "Height", coalesce: "height" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        {p.dims === "inner" ? "Outside" : "Inside"}:{" "}
                        <span className="text-muted-foreground">
                            {xyz(p.dims === "inner" ? result.outer : result.inner)}
                        </span>
                    </p>
                )}
            </PanelSection>

            {/* ── The sheet it is cut from ───────────────────────────────── */}
            <PanelSection id="box-material" title="Material" icon={<Layers3 className="size-3" />}>
                <SliderField
                    label="Thickness"
                    hint="The single most important number here: every joint is exactly this deep, so a box drawn for 3 mm ply will not go together in 3.2 mm ply. Measure the actual sheet with callipers rather than trusting what it was sold as."
                    value={p.thickness}
                    min={L.minThickness}
                    max={12}
                    step={0.1}
                    onChange={n => params.set({ thickness: n }, { label: "Thickness", coalesce: "thickness" })}
                />
                <SliderField
                    label="Kerf"
                    hint="How much width the beam burns away. Every finger is drawn half a kerf oversize and every notch half a kerf under, so the parts come out the size they were meant to be. To measure yours: cut a 20 mm square, measure it, and the difference is the kerf."
                    value={p.kerf}
                    min={0}
                    max={L.maxKerf}
                    step={0.01}
                    onChange={n => params.set({ kerf: n }, { label: "Kerf", coalesce: "kerf" })}
                />
                <SliderField
                    label="Fit"
                    hint="Extra room per finger side, on top of the kerf. 0 is a tap-together fit that needs a mallet and holds without glue; raise it towards 0.1 mm if your last box needed a hammer, and it becomes a slip fit that wants glue."
                    value={p.clearance}
                    min={0}
                    max={L.maxClearance}
                    step={0.01}
                    onChange={n => params.set({ clearance: n }, { label: "Fit", coalesce: "clearance" })}
                />
            </PanelSection>

            {/* ── How the panels meet ────────────────────────────────────── */}
            <PanelSection id="box-joints" title="Joints">
                <SliderField
                    label="Finger width"
                    hint={`How wide each tooth is. 0 works it out from the sheet — three times the thickness, which is ${mm(Math.max(6, Math.min(20, 3 * p.thickness)))} here. Every edge divides into an odd number of teeth so both ends match, so the real width lands near this rather than on it.`}
                    value={p.finger || (result?.finger ?? 0)}
                    min={L.minFinger}
                    max={40}
                    onChange={n => params.set({ finger: n }, { label: "Finger width", coalesce: "finger" })}
                />
                {p.finger > 0 && (
                    <button
                        onClick={() => params.set({ finger: 0 }, { label: "Finger width" })}
                        className="text-[11px] text-accent/80 underline decoration-accent/40 underline-offset-2 transition-colors hover:text-accent"
                    >
                        back to following the sheet
                    </button>
                )}
                <SegmentedField
                    label="Floor & lid"
                    hint={JOINTS.find(o => o.id === p.panelJoint)!.hint}
                    value={p.panelJoint}
                    choices={JOINTS}
                    onChange={(v: PanelJoint) => params.set({ panelJoint: v }, { label: "Floor joint" })}
                />
                {p.panelJoint === "offset" && (
                    <>
                        <SliderField
                            label="Inset by"
                            hint="How far the floor is raised off the bottom of the walls. The walls grow to match — the box keeps the height you asked for — so this comes out of the space inside rather than adding to the outside."
                            value={p.panelOffset}
                            min={p.thickness}
                            max={L.maxOffset}
                            onChange={n => params.set({ panelOffset: n }, { label: "Floor inset", coalesce: "panelOffset" })}
                        />
                        <p className="text-[11px] leading-relaxed text-subtle-foreground">
                            The walls stay {result ? mm(result.outer.h) : "the same height"} and the floor moves up
                            them, so the room left inside drops to{" "}
                            <span className="text-muted-foreground">{mm(innerH)}</span>.
                        </p>
                    </>
                )}
            </PanelSection>

            {/* ── What closes it ─────────────────────────────────────────── */}
            <PanelSection id="box-lid" title="Lid">
                <SelectField
                    label="Type"
                    hint={LIDS.find(o => o.id === p.lid)!.hint}
                    value={p.lid}
                    choices={LIDS}
                    onChange={(v: LidType) => params.set({ lid: v }, { label: "Lid" })}
                />

                {bTallLid && (
                    <SliderField
                        label="Lid height"
                        hint={p.lid === "tray"
                            ? "How deep the tray is. It slips over the outside of the box, so this is how far down the sides it reaches."
                            : "How much of the box's total height is the lid half. The rest is the base, which is where the hinge ears are screwed on."}
                        value={p.lidHeight}
                        min={5}
                        max={Math.max(10, p.height - 5)}
                        onChange={n => params.set({ lidHeight: n }, { label: "Lid height", coalesce: "lidHeight" })}
                    />
                )}

                {p.lid === "layon" && (
                    <ToggleField
                        label="Locating lip"
                        hint="A second plate, the size of the opening less the play below, glued centred under the lid. Without it the lid is a loose tile that slides off; with it, it drops into place. Its outline is engraved on the lid's underside so it can be glued square."
                        checked={p.lidLip}
                        onChange={b => params.set({ lidLip: b }, { label: "Locating lip" })}
                    />
                )}

                {bPlay && (
                    <SliderField
                        label="Play"
                        hint="The gap on each side between a part that has to move and the one it moves in — the lid's lip in the opening, the tray over the box, a divider between the walls. 0.1 mm is a lid you can lift with one finger; 0 is one that jams the first humid day."
                        value={p.lidClearance}
                        min={0}
                        max={L.maxLidClearance}
                        step={0.05}
                        onChange={n => params.set({ lidClearance: n }, { label: "Play", coalesce: "lidClearance" })}
                    />
                )}

                {p.lid === "hinged" && (
                    <>
                        <SliderField
                            label="Pin ⌀"
                            hint="What the lid turns on: a length of 3 mm rod, or an M3 screw with a nut on the far side. The holes are cut to this exactly, with a shade of play on the pivot itself."
                            value={p.pin}
                            min={1.5}
                            max={8}
                            step={0.5}
                            onChange={n => params.set({ pin: n }, { label: "Pin diameter", coalesce: "pin" })}
                        />
                        <SliderField
                            label="Pivot behind"
                            hint="How far behind the back of the box the pin sits. This is what makes the hinge work: from a point behind and above the rim, every part of the lid rises as it opens, so nothing has to be cut away for clearance. Bigger means the lid stands further off as it opens."
                            value={p.hingeOffset}
                            min={1}
                            max={20}
                            step={0.5}
                            onChange={n => params.set({ hingeOffset: n }, { label: "Pivot offset", coalesce: "hingeOffset" })}
                        />
                        <p className="text-[11px] leading-relaxed text-subtle-foreground">
                            Two ears are cut with it. They screw to the <em>outside</em> of the box's side walls —
                            the holes are already there — and the lid's knuckles turn on a pin through them.
                        </p>
                    </>
                )}
            </PanelSection>

            {/* ── What goes inside ───────────────────────────────────────── */}
            <PanelSection id="box-dividers" title="Dividers" icon={<Columns3 className="size-3" />} defaultOpen={false}>
                <SliderField
                    label="Across the width"
                    hint="Dividers running front to back. Two of them make three compartments across."
                    value={p.dividersW}
                    min={0}
                    max={L.maxDividers}
                    step={1}
                    unit=""
                    onChange={n => params.set({ dividersW: Math.round(n) }, { label: "Dividers", coalesce: "dividersW" })}
                />
                <SliderField
                    label="Across the depth"
                    hint="Dividers running left to right."
                    value={p.dividersD}
                    min={0}
                    max={L.maxDividers}
                    step={1}
                    unit=""
                    onChange={n => params.set({ dividersD: Math.round(n) }, { label: "Dividers", coalesce: "dividersD" })}
                />
                {p.dividersW + p.dividersD > 0 && (
                    <>
                        <SliderField
                            label="Height"
                            hint={`How tall the dividers stand. 0 fills the open half of the box — ${mm(wellH)} here — so a lid rests on them as well as on the rim.`}
                            value={p.dividerHeight || wellH}
                            min={5}
                            max={Math.max(10, wellH)}
                            onChange={n => params.set({ dividerHeight: n }, { label: "Divider height", coalesce: "dividerHeight" })}
                        />
                        <p className="text-[11px] leading-relaxed text-subtle-foreground">
                            They cross-lap into each other — slots down from the top on one set, up from the bottom on
                            the other — and drop into the assembled box as one grid. Nothing is glued, so the layout
                            can be changed later.
                        </p>
                    </>
                )}
            </PanelSection>

            {/* ── How it is nested for cutting ───────────────────────────── */}
            <PanelSection id="box-sheet" title="Sheet" icon={<Ruler className="size-3" />} defaultOpen={false}>
                <SliderField
                    label="Sheet width"
                    hint="Parts are laid in rows no wider than this — set it to your machine's bed. A part too big for it widens the sheet rather than being dropped, and the status bar says so."
                    value={p.sheetWidth}
                    min={L.minSheet}
                    max={800}
                    step={10}
                    onChange={n => params.set({ sheetWidth: n }, { label: "Sheet width", coalesce: "sheetWidth" })}
                />
                <SliderField
                    label="Gap"
                    hint="Space kept between parts. A couple of millimetres is enough to stop one cut scorching its neighbour; more if the sheet warps as it heats."
                    value={p.gap}
                    min={0}
                    max={30}
                    step={0.5}
                    onChange={n => params.set({ gap: n }, { label: "Gap", coalesce: "gap" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        {result.aPart.length} parts nested into{" "}
                        <span className="text-muted-foreground">
                            {result.width.toFixed(0)} × {result.height.toFixed(0)} mm
                        </span>.
                    </p>
                )}
            </PanelSection>
        </Workspace>
    );
}
