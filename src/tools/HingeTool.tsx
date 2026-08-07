import { useCallback, useMemo } from "react";
import { Layers3, Ruler, Spline, Waves } from "lucide-react";
import { HINGE_LIMITS, buildHinge, hingeToDxf, hingeToFds, hingeToSvg } from "../lib/hinge";
import type { BendAxis, HingeOptions, HingePattern } from "../lib/hinge";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { PairField, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Living hinge.
//
// The panel is ordered by what actually decides whether it works:
//
//   Panel     — how big, and which way it rolls. The axis is first because a
//               hinge cut the wrong way round does not bend at all.
//   Pattern   — the field of slits, and the two numbers in it that matter
//   Material  — thickness and kerf, which is what turns the geometry into a
//               prediction about wood
//   Bend      — the radius you are aiming for, and what it costs
//
// The last section is a readout as much as a control: the radius changes
// nothing that gets cut, it only tells you whether what is cut will survive
// being bent to it.
// ---------------------------------------------------------------------------

const L = HINGE_LIMITS;

interface HingeParams extends HingeOptions {}

const DEFAULTS: HingeParams = {
    width: 120,
    height: 80,
    bendAxis: "vertical",
    pattern: "straight",
    pitch: 5,
    link: 5,
    slit: 25,
    inset: 0,
    flat: 0,
    thickness: 3,
    kerf: 0.15,
    radius: 40,
    outline: true,
    amplitude: 0.25
};

const AXES = [
    { id: "vertical" as const, label: "Left to right", hint: "The panel curls around an upright axis, like the side of a tube standing on its end. The slits run up and down." },
    { id: "horizontal" as const, label: "Top to bottom", hint: "The panel curls around a horizontal axis, like a roll-top. The slits run across." }
];

const PATTERNS = [
    { id: "straight" as const, label: "Straight", hint: "Plain slits, brick-offset. The classic lattice: the stiffest of the three, the quickest to cut, and the one that snaps first at a slit end." },
    { id: "wave" as const, label: "Wave", hint: "The same field with each slit running as one S. The material at the end of a slit is never asked to turn a corner, which is where a straight one splits — and the longer cut takes the same bend more gently." },
    { id: "tee" as const, label: "T-ends", hint: "Straight slits with a short bar across each end. A slit tip concentrates all the stress in the link at one point, and that point is where every failed hinge cracks; a bar spreads it along a line. Costs a little stiffness, buys a hinge that opens twice." }
];

const PRESETS: Preset<HingeParams>[] = [
    {
        id: "lid",
        label: "Curved box lid",
        hint: "A band across the middle, flat ends to glue into the box",
        patch: { pattern: "straight", pitch: 5, link: 5, slit: 25, flat: 20, outline: true }
    },
    {
        id: "roll",
        label: "Tight roll",
        hint: "Rows close together and long links — for a small radius",
        patch: { pattern: "tee", pitch: 3, link: 8, slit: 30, flat: 0 }
    },
    {
        id: "decor",
        label: "Decorative wave",
        hint: "The whole panel, as a pattern you can see",
        patch: { pattern: "wave", pitch: 7, link: 6, slit: 30, amplitude: 0.35, flat: 0 }
    },
    {
        id: "strip",
        label: "Test strip",
        hint: "40 × 60 mm — cut this before you cut the panel",
        patch: { width: 40, height: 60, flat: 0, inset: 0, outline: true }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;
const degrees = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(1)}°`;

export default function HingeTool() {
    const params = useHistoryParams<HingeParams>(DEFAULTS, { storageKey: "laserkit:params:hinge" });
    const p = params.value;

    const build = useCallback((o: HingeParams) => buildHinge(o), []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        // The radius, the thickness and the kerf change what the tool *says*
        // and not one line of what it cuts, so they never refit the view.
        fitKey: [p.width, p.height, p.bendAxis, p.pattern, p.pitch, p.link, p.slit, p.inset, p.flat, p.outline].join("|"),
        fallbackError: "This hinge could not be worked out."
    });

    const stem = useMemo(
        () => `hinge_${Math.round(p.width)}x${Math.round(p.height)}_${p.pattern}`,
        [p.width, p.height, p.pattern]
    );

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "HINGE",
        build: fmt => fmt === "fds"
            ? hingeToFds(result)
            : textBlob(fmt === "dxf" ? hingeToDxf(result) : hingeToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = [{ color: "#ff0000", label: "cut" }];

    const bendSpan = p.bendAxis === "vertical" ? p.width : p.height;

    return (
        <Workspace
            toolId="hinge"
            subject="Hinge"
            subtitle={result ? `${result.rows} rows · ${mm(result.pitch)} apart` : undefined}
            documentName={result ? `${result.width.toFixed(0)} × ${result.height.toFixed(0)} mm` : "Hinge"}
            from={null}
            tabs={[]}
            tab={0}
            onTab={() => undefined}
            empty={false}
            inspectorEmpty={false}
            openable={false}
            busy={false}
            error={error}
            onOpenFile={() => undefined}
            onClose={() => undefined}
            params={params}
            stage={{ svg: result?.preview ?? "", fitKey, pending }}
            legend={legend}
            stats={result ? [
                { label: "Panel", value: `${result.width.toFixed(0)} × ${result.height.toFixed(0)} mm` },
                { label: "Rows", value: `${result.rows} · ${mm(result.pitch)}`, hint: "How many rows of slits cross the bend, and how far apart they came out. The spacing is rounded so the field fits the panel exactly rather than leaving a stub at one edge." },
                { label: "Link", value: mm(result.effectiveLink), hint: "What is left of the uncut material between two slits once the beam has been through both ends. This is the part that twists, and the part that breaks." },
                { label: "Twist / row", value: degrees(result.twistPerRow), hint: "How far one row turns relative to the next at the radius you set. Exactly the pitch over the radius — no material constant in it at all." },
                { label: "Strain", value: `${(result.strain * 100).toFixed(1)} %`, hint: "Peak shear in a link at that twist. Past about 3.5 % most sheet gives up, which is where the warning starts — but that figure is a rule of thumb and your material is not." },
                { label: "Tightest", value: mm(result.minRadius), hint: "The smallest radius this pattern should be asked for, by that same rule of thumb." },
                { label: "Cut", value: `${(result.cutLength / 1000).toFixed(2)} m`, hint: "How far the head travels with the beam on." }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? hingeToSvg(result) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "hinge-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── The panel, and which way it rolls ──────────────────────── */}
            <PanelSection id="hinge-panel" title="Panel" icon={<Ruler className="size-3" />}>
                <PairField
                    label="Size"
                    hint="The flat panel, before it is bent. Bending it does not change how much material it is — only how much room it takes up."
                    w={p.width}
                    h={p.height}
                    min={L.minSize}
                    onW={n => params.set({ width: n }, { label: "Width", coalesce: "width" })}
                    onH={n => params.set({ height: n }, { label: "Height", coalesce: "height" })}
                />
                <SegmentedField
                    label="Bends"
                    hint={AXES.find(o => o.id === p.bendAxis)!.hint}
                    value={p.bendAxis}
                    choices={AXES}
                    onChange={(v: BendAxis) => params.set({ bendAxis: v }, { label: "Bend axis" })}
                />
                <SliderField
                    label="Flat ends"
                    hint="Uncut material at each end of the bend, so the hinge is a band across the middle rather than the whole panel. This is what a curved box lid wants: two flat ends to glue into the sides, and the curve between them."
                    value={p.flat}
                    min={0}
                    max={Math.max(0, bendSpan / 2 - 2)}
                    onChange={n => params.set({ flat: n }, { label: "Flat ends", coalesce: "flat" })}
                />
                <ToggleField
                    label="Cut the outline"
                    hint="Off leaves only the slits, for dropping the pattern into a panel some other tool already cut."
                    checked={p.outline}
                    onChange={b => params.set({ outline: b }, { label: "Outline" })}
                />
            </PanelSection>

            {/* ── The field of slits ─────────────────────────────────────── */}
            <PanelSection id="hinge-pattern" title="Pattern" icon={<Waves className="size-3" />}>
                <SelectField
                    label="Cut"
                    hint={PATTERNS.find(o => o.id === p.pattern)!.hint}
                    value={p.pattern}
                    choices={PATTERNS}
                    onChange={(v: HingePattern) => params.set({ pattern: v }, { label: "Pattern" })}
                />
                <SliderField
                    label="Row spacing"
                    hint="How far apart the rows of slits are, across the bend. This is the number that decides how tightly the panel rolls: each row turns the pitch over the radius, so halving it halves the twist every row has to take. It is rounded to fit the panel exactly."
                    value={p.pitch}
                    min={L.minPitch}
                    max={L.maxPitch}
                    step={0.5}
                    onChange={n => params.set({ pitch: n }, { label: "Row spacing", coalesce: "pitch" })}
                />
                <SliderField
                    label="Link"
                    hint="The uncut material between two slits, end to end. It is what twists and what breaks, so it is held exactly — the slit length gives way to make the rows fit. Longer links bend further; shorter ones are stiffer and snap."
                    value={p.link}
                    min={L.minLink}
                    max={L.maxLink}
                    step={0.5}
                    onChange={n => params.set({ link: n }, { label: "Link", coalesce: "link" })}
                />
                <SliderField
                    label="Slit length"
                    hint={`How long each slit wants to be. Adjusted so a whole number of them fits, which is why it came out at ${result ? mm(result.slit) : "the figure in the status bar"}.`}
                    value={p.slit}
                    min={L.minSlit}
                    max={Math.max(L.minSlit + 1, p.bendAxis === "vertical" ? p.height : p.width)}
                    onChange={n => params.set({ slit: n }, { label: "Slit length", coalesce: "slit" })}
                />
                {p.pattern === "wave" && (
                    <SliderField
                        label="Wave depth"
                        hint="How far the S wanders either side of its row, as a fraction of the row spacing. Deeper is more flexible and eats more of the gap to the next row."
                        value={p.amplitude}
                        min={0.05}
                        max={0.45}
                        step={0.05}
                        unit=""
                        onChange={n => params.set({ amplitude: n }, { label: "Wave depth", coalesce: "amplitude" })}
                    />
                )}
                <SliderField
                    label="Border"
                    hint="Uncut material along the two edges the slits run towards. Usually 0: a border is stiffer than everything inside it, so the hinge bends around it rather than with it. Raise it only if something has to be screwed to that edge."
                    value={p.inset}
                    min={0}
                    max={20}
                    step={0.5}
                    onChange={n => params.set({ inset: n }, { label: "Border", coalesce: "inset" })}
                />
            </PanelSection>

            {/* ── What it is being cut from ──────────────────────────────── */}
            <PanelSection id="hinge-material" title="Material" icon={<Layers3 className="size-3" />}>
                <SliderField
                    label="Thickness"
                    hint="Only used to work out the strain — no part of the drawing depends on it. A thicker sheet shears its links harder for the same bend, in proportion."
                    value={p.thickness}
                    min={0.5}
                    max={12}
                    step={0.1}
                    onChange={n => params.set({ thickness: n }, { label: "Thickness", coalesce: "thickness" })}
                />
                <SliderField
                    label="Kerf"
                    hint="How much width the beam burns away. It comes off both ends of every link, so a 5 mm link in a 0.15 mm kerf is really 4.85 mm of material — and at a 1 mm link that difference is a fifth of the part that has to hold."
                    value={p.kerf}
                    min={0}
                    max={L.maxKerf}
                    step={0.01}
                    onChange={n => params.set({ kerf: n }, { label: "Kerf", coalesce: "kerf" })}
                />
            </PanelSection>

            {/* ── What you are aiming for ────────────────────────────────── */}
            <PanelSection id="hinge-bend" title="Bend" icon={<Spline className="size-3" />}>
                <SliderField
                    label="Radius"
                    hint="The radius you mean to bend it to. Nothing in the drawing depends on this — it is the question the numbers below are answering."
                    value={p.radius}
                    min={2}
                    max={400}
                    onChange={n => params.set({ radius: n }, { label: "Radius", coalesce: "radius" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        {result.rows} rows, each turning{" "}
                        <span className="text-muted-foreground">{degrees(result.twistPerRow)}</span>, wrap{" "}
                        <span className="text-muted-foreground">
                            {degrees((p.bendAxis === "vertical" ? p.width - 2 * p.flat : p.height - 2 * p.flat) / Math.max(1, p.radius))}
                        </span>{" "}
                        of a {mm(p.radius)} circle.
                    </p>
                )}
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    The strain figure is geometry against a rule of thumb, not a property of your sheet. Plywood
                    across the plies, acrylic and MDF all give up at different points, and the same board behaves
                    differently damp. Cut the <em>test strip</em> preset and bend it.
                </p>
            </PanelSection>
        </Workspace>
    );
}
