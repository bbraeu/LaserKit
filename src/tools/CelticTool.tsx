import { useCallback, useMemo } from "react";
import { Dices, Download, Leaf, Sprout, Waypoints } from "lucide-react";
import {
    CELTIC_LIMITS,
    PREVIEW_STROKE,
    buildCelticTree,
    celticSheet,
    celticToSvg,
    cutSheet
} from "../lib/celtic";
import type { CelticOptions, CelticSheet } from "../lib/celtic";
import { ringsOf } from "../lib/boolean";
import { framedToDxf, framedToFds } from "../lib/wordsearch";
import type { Framed } from "../lib/wordsearch";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Preview } from "../workspace/Preview";
import { Workspace } from "../workspace/Workspace";
import { Field, SliderField, ToggleField } from "../workspace/fields";
import { NumberField } from "../workspace/fields/NumberField";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// The Celtic tree of life.
//
// There is almost nothing in this file, and that is the point of the rework.
//
// It used to be where the design was finished: `buildCelticTree` handed back
// centrelines, and this component painted them onto a canvas, traced the
// bitmap, and called the result the cut layer. That put half the geometry in a
// React component, made it untestable outside a browser, and put a raster round
// trip in the middle of a vector pipeline.
//
// Now the library does the booleans and hands back `Region[]` — an outline and
// the holes in it — so this file is a panel of controls and four export
// buttons. Everything that decides what the piece looks like, including which
// leaves are cut and which are engraved, is in src/lib/celtic.ts where a unit
// test can measure it.
// ---------------------------------------------------------------------------

const L = CELTIC_LIMITS;

interface CelticParams extends CelticOptions {
    /**
     * A plain disc the same size, to go behind the tree.
     *
     * The openwork is holes, and holes show whatever the piece is standing in
     * front of. A second disc in a contrasting sheet turns that from "the wall"
     * into part of the design, and it is the one companion piece that costs
     * nothing to work out — so it is offered rather than left as an exercise.
     */
    backing: boolean;
}

const DEFAULTS: CelticParams = {
    size: 150,
    // A 12 mm band with twelve loops in it: wide enough that the three strands
    // are nearly 3 mm each after the gap, dense enough to read as knotwork
    // rather than as a wavy line.
    ringWidth: 12,
    knotDensity: 12,
    braidGap: 1.2,
    trunk: 10,
    sway: 0.5,
    branch: 7,
    depth: 4,
    density: 5,
    variance: 0.5,
    leaves: true,
    leafSize: 7,
    leafCount: 48,
    base: true,
    thickness: 3,
    kerf: 0.15,
    seed: 1,
    backing: false
};

const PRESETS: Preset<CelticParams>[] = [
    {
        id: "wreath",
        label: "Braided wreath",
        hint: "A 150 mm disc, a 12 mm plait, a full canopy",
        patch: { size: 150, ringWidth: 12, knotDensity: 12, braidGap: 1.2, density: 5, depth: 4, leaves: true, leafSize: 7, leafCount: 48 }
    },
    {
        id: "knotwork",
        label: "Wide knotwork",
        hint: "A deep band with the plait given room to breathe",
        patch: { size: 200, ringWidth: 24, knotDensity: 16, braidGap: 2.5, density: 4, depth: 4, leafSize: 9, leafCount: 40 }
    },
    {
        id: "winter",
        label: "Winter tree",
        hint: "No leaves, one more level of twigs, fine branches",
        patch: { leaves: false, depth: 5, density: 3, branch: 4, variance: 0.7, sway: 0.7 }
    },
    {
        id: "oak",
        label: "Old oak",
        hint: "A heavy swaying trunk under fine branches",
        patch: { trunk: 18, branch: 4.5, sway: 0.9, density: 7, depth: 4, variance: 0.6, leafCount: 70, leafSize: 6 }
    },
    {
        id: "stand",
        label: "Standing set",
        hint: "Tabs, two feet and a disc to go behind it",
        patch: { base: true, backing: true, size: 180, ringWidth: 16 }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

/** A sheet as the DXF and FDS writers want it. */
const framedOf = (s: CelticSheet): Framed => ({
    aLayer: s.aLayer.map(l => ({ operation: l.operation, rings: l.rings, filled: false })),
    width: s.width,
    height: s.height
});

export default function CelticTool() {
    const params = useHistoryParams<CelticParams>(DEFAULTS, { storageKey: "laserkit:params:celtic" });
    const p = params.value;

    const build = useCallback((o: CelticParams) => {
        const tree = buildCelticTree(o),
            design = celticSheet(tree);
        return {
            tree,
            design,
            // The stage gets a thicker line than the file does: a tenth of a
            // millimetre is half a pixel at the zoom a whole disc fits at.
            preview: celticToSvg(design, PREVIEW_STROKE),
            feet: tree.feet ? cutSheet(tree.feet.rings, tree.feet.width, tree.feet.height) : null,
            backing: o.backing ? cutSheet(ringsOf(tree.aBacking), tree.size, tree.height) : null
        };
    }, []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        // The tabs make the piece taller than it is wide, so switching the base
        // on is a different drawing and deserves a refit.
        fitKey: `${p.size}|${p.base}`,
        fallbackError: "This tree could not be turned into geometry.",
        // A hundred-odd polygons through a real boolean union on every change:
        // about eighty milliseconds at the defaults, so the delay is here to
        // stop a slider drag queueing one of those per pixel of travel.
        delay: 160
    });

    const stem = useMemo(
        () => `celtic_tree_${Math.round(p.size)}mm_${p.density}x${p.depth}_${p.seed}`,
        [p.size, p.density, p.depth, p.seed]
    );

    const exports: ExportItem[] = useMemo(() => {
        if (!result) return [];
        return [
            ...designExports({
                stem,
                eventPrefix: "CELTIC",
                build: fmt => fmt === "fds"
                    ? framedToFds(framedOf(result.design))
                    : textBlob(
                        fmt === "dxf" ? framedToDxf(framedOf(result.design)) : celticToSvg(result.design),
                        fmt
                    )
            }),
            ...(result.feet ? [{
                id: "feet",
                label: "Feet",
                desc: `Two feet ${mm(result.feet.width)} × ${mm(result.feet.height)}, slotted for a ${mm(p.thickness)} sheet with the kerf already added`,
                filename: `${stem}_feet.svg`,
                blob: () => textBlob(celticToSvg(result.feet!), "svg"),
                event: "CELTIC_FEET_Download",
                group: "extra" as const
            }] : []),
            ...(result.backing ? [{
                id: "backing",
                label: "Backing disc",
                desc: `A plain ⌀ ${mm(result.tree.size)} disc to go behind the openwork, tabs and all`,
                filename: `${stem}_backing.svg`,
                blob: () => textBlob(celticToSvg(result.backing!), "svg"),
                event: "CELTIC_BACKING_Download",
                group: "extra" as const
            }] : [])
        ];
    }, [result, stem, p.thickness]);

    const legend: LegendItem[] = [
        { color: "#ff0000", label: "cut" },
        ...(result && result.tree.markCount > 0 ? [{ color: "#00a000", label: "engraved leaves" }] : [])
    ];

    // The companion pieces, each as its own tab under the stage. There is no
    // empty array here: with neither of them asked for, the strip of buttons
    // has nothing to say and should not be on screen at all.
    const bottomPanels = [
        ...(result?.feet ? [{
            id: "feet",
            title: "Feet (2 pieces)",
            defaultOpen: true,
            children: (
                <div className="grid h-full gap-3 lg:grid-cols-[1fr_18rem]">
                    <Preview
                        svg={celticToSvg(result.feet, PREVIEW_STROKE)}
                        fitKey={`feet|${result.feet.width}|${result.feet.height}`}
                        subject="feet"
                        className="min-h-56"
                        data-testid="feet-preview"
                    />
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        Two plates with a slot each, cut from the same {mm(p.thickness)} sheet. The tabs under the disc
                        drop into them and it stands up. The slot is the sheet plus {mm(p.kerf)} of kerf, because a
                        slot cut to the nominal thickness is a slot the tab does not go into — and the tab hangs below
                        the <em>bottom of the circle</em>, not below where it leaves the rim, or the disc would land on
                        its own edge with the slots still empty. Export →{" "}
                        <span className="text-muted-foreground">Feet</span>.
                    </p>
                </div>
            )
        }] : []),
        ...(result?.backing ? [{
            id: "backing",
            title: "Backing disc",
            defaultOpen: false,
            children: (
                <div className="grid h-full gap-3 lg:grid-cols-[1fr_18rem]">
                    <Preview
                        svg={celticToSvg(result.backing, PREVIEW_STROKE)}
                        fitKey={`backing|${result.tree.size}|${result.tree.height}`}
                        subject="backing disc"
                        className="min-h-56"
                        data-testid="backing-preview"
                    />
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        The same disc with nothing cut out of it, tabs included, so it stands in the same feet directly
                        behind the tree. Cut it from a sheet that contrasts — dark behind light, or a mirror acrylic —
                        and the openwork stops showing you the wall. Export →{" "}
                        <span className="text-muted-foreground">Backing disc</span>.
                    </p>
                </div>
            )
        }] : [])
    ];

    return (
        <Workspace
            toolId="celtic"
            subject="Tree of life"
            subtitle={result ? `${result.tree.branchCount} branches · ${result.tree.ring.lobes}-loop plait` : undefined}
            documentName={result ? `Tree of life ⌀ ${result.tree.size.toFixed(0)} mm` : "Tree of life"}
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
                { label: "Diameter", value: `${result.tree.size.toFixed(0)} mm` },
                { label: "Branches", value: String(result.tree.branchCount) },
                {
                    label: "Leaves",
                    value: `${result.tree.leafCount} cut · ${result.tree.markCount} engraved`,
                    hint: "A leaf that would be swallowed by the branch it grows on, by the frame or by the leaf beside it is engraved instead of cut. Merged into the union it would lose its own outline and the canopy would come out as a lump; engraved, you still see every one of them and no second cut line runs through the twig."
                },
                {
                    label: "One piece",
                    value: result.tree.bJoined ? "yes" : `no — ${result.tree.aCut.length} parts`,
                    hint: "Whether the whole drawing merged into a single region. This is the one fault the canvas cannot show you: two regions means something in the picture is a separate piece of material, and it falls out of the frame on the bed."
                },
                {
                    label: "Thinnest twig",
                    value: `${result.tree.thinnest.toFixed(2)} mm`,
                    hint: "The narrowest limb in the drawing, which is the first thing to snap. Under a millimetre it goes while you are lifting the piece off the bed; under two it is delicate in anything but plywood. Raise the branch width or take a level off the depth."
                },
                {
                    label: "Strand",
                    value: `${result.tree.ring.strand.toFixed(1)} mm`,
                    hint: "One strand of the plait across, which is the ring width divided by three with the braid gap taken out of it. Under a millimetre the whole edge of the piece is a wire."
                },
                {
                    label: "Cut paths",
                    value: String(result.tree.pieces),
                    hint: "Closed contours in the cut layer: the real edge of the real piece plus the real holes in it. Because everything is merged with a true boolean union, there is never a seam where two branches happen to overlap — one crossing, one join."
                },
                {
                    label: "Merged in",
                    value: `${result.tree.unionMs.toFixed(0)} ms`,
                    hint: "How long the booleans took on your machine. Depth and branch density are what move it: every extra level doubles the number of limbs that have to be merged."
                }
            ] : []}
            warnings={result?.tree.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? celticToSvg(result.design) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "celtic-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
            bottomPanels={bottomPanels.length ? bottomPanels : undefined}
        >
            {/* ── The plaited ring ───────────────────────────────────────── */}
            <PanelSection id="celtic-frame" title="Frame (knot)" icon={<Waypoints className="size-3" />}>
                <SliderField
                    label="Diameter"
                    hint="The whole disc. Everything else is a fraction of it, so the tree is the same tree at 60 mm and at 300 — but the twigs are not, because they get thinner as the disc gets smaller."
                    value={p.size}
                    min={L.minSize}
                    max={400}
                    onChange={n => params.set({ size: n }, { label: "Diameter", coalesce: "size" })}
                />
                <SliderField
                    label="Ring width"
                    hint="How wide the plaited band is. It is the whole edge of the piece and everything hangs off it: the branches and the roots both grow into it, and the tabs hang from it. Three strands share this width, so a narrow ring means thin strands."
                    value={p.ringWidth}
                    min={3}
                    max={Math.max(6, Math.round(p.size * 0.3))}
                    step={0.5}
                    onChange={n => params.set({ ringWidth: n }, { label: "Ring width", coalesce: "ringWidth" })}
                />
                <SliderField
                    label="Knot density"
                    hint="How many loops the braid makes round the circle. Low is a slow, generous plait; high is fine knotwork. There is a ceiling that depends on the ring width — past it the strands sweep across the band faster than they are wide, the whitespace closes up, and the plait becomes a plain band. The tool holds it there and says so."
                    value={p.knotDensity}
                    min={L.minKnot}
                    max={L.maxKnot}
                    step={1}
                    unit=" loops"
                    onChange={n => params.set({ knotDensity: Math.round(n) }, { label: "Knot density", coalesce: "knotDensity" })}
                />
                <SliderField
                    label="Braid gap"
                    hint="The whitespace between one strand and the next, in millimetres — which on a cut piece is the hole. It comes out of the strand width, so opening the gap thins the strands rather than widening the ring."
                    value={p.braidGap}
                    min={0}
                    max={8}
                    step={0.1}
                    onChange={n => params.set({ braidGap: n }, { label: "Braid gap", coalesce: "braidGap" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        {result.tree.ring.lobes} loops of {mm(result.tree.ring.strand)} strand, closed top and bottom by
                        a {mm(result.tree.ring.rim)} rim. The rims are not trim: they turn the gaps between the strands
                        into real holes and give the branches something solid to land on.
                    </p>
                )}
            </PanelSection>

            {/* ── The tree itself ────────────────────────────────────────── */}
            <PanelSection id="celtic-tree" title="Tree structure" icon={<Sprout className="size-3" />}>
                <Field
                    label="Seed"
                    hint="Which tree this is. Every bend, every taper and every leaf comes from it, so the same seed always gives the same tree — go back to the number and you go back to the tree."
                    control={
                        <NumberField
                            label="Seed, exact value"
                            value={p.seed}
                            min={1}
                            max={999999}
                            unit=""
                            onChange={n => params.set({ seed: Math.max(1, Math.round(n)) }, { label: "Seed" })}
                        />
                    }
                >
                    <button
                        onClick={() => params.set({ seed: 1 + Math.floor(Math.random() * 999998) }, { label: "Seed" })}
                        className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-panel-2 text-xs text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
                        data-testid="celtic-regenerate"
                    >
                        <Dices className="size-3.5" />
                        Grow another tree
                    </button>
                </Field>
                <SliderField
                    label="Trunk thickness"
                    hint="The trunk where it stands on the ring. It flares to more than twice this at the very foot and is already slim by the first fork, which is what a trunk does and what an even taper cannot look like."
                    value={p.trunk}
                    min={1}
                    max={40}
                    step={0.5}
                    onChange={n => params.set({ trunk: n }, { label: "Trunk thickness", coalesce: "trunk" })}
                />
                <SliderField
                    label="Trunk sway"
                    hint="How far the trunk curves on its way up. It is anchored at the foot, so it always stands square on the band however far it leans further up — a trunk that leans from its own base looks like it is falling over."
                    value={p.sway}
                    min={0}
                    max={1}
                    step={0.05}
                    unit=""
                    onChange={n => params.set({ sway: n }, { label: "Trunk sway", coalesce: "sway" })}
                />
                <SliderField
                    label="Branch thickness"
                    hint="What a primary leaves the trunk at — its own control, not a fraction of the trunk. A heavy trunk under fine branches is an oak; the same branches on a slim trunk is a birch. Each level then keeps about three quarters of its parent, give or take a seventh, so this is the number that decides whether the outer twigs survive being lifted off the bed."
                    value={p.branch}
                    min={0.5}
                    max={20}
                    step={0.5}
                    onChange={n => params.set({ branch: n }, { label: "Branch thickness", coalesce: "branch" })}
                />
                <SliderField
                    label="Branch density"
                    hint="How many primaries leave the trunk. Each of them forks in two at every level, so the twig count is this times two to the depth — two is a sapling, ten is a full canopy on a rim that is nearly solid with tips."
                    value={p.density}
                    min={L.minDensity}
                    max={L.maxDensity}
                    step={1}
                    unit=""
                    onChange={n => params.set({ density: Math.round(n) }, { label: "Branch density", coalesce: "density" })}
                />
                <SliderField
                    label="Branch depth"
                    hint="How many times a limb splits before it stops. Each level covers about half the distance left to the ring, so more levels is a finer canopy rather than a bigger one — and each is about 74 % of its parent's width, which is where the thinnest twig comes from."
                    value={p.depth}
                    min={L.minDepth}
                    max={L.maxDepth}
                    step={1}
                    unit=""
                    onChange={n => params.set({ depth: Math.round(n) }, { label: "Branch depth", coalesce: "depth" })}
                />
                <SliderField
                    label="Angle variance"
                    hint="How far a limb bends off straight, and how far the two children fan out from their parent. At zero it is a diagram of a tree; at one it is a bramble. The middle is where it looks grown."
                    value={p.variance}
                    min={0}
                    max={1}
                    step={0.05}
                    unit=""
                    onChange={n => params.set({ variance: n }, { label: "Angle variance", coalesce: "variance" })}
                />
            </PanelSection>

            {/* ── What hangs off it ──────────────────────────────────────── */}
            <PanelSection id="celtic-leaves" title="Leaves" icon={<Leaf className="size-3" />}>
                <ToggleField
                    label="Leaves"
                    hint="Leaves at the ends of the outer twigs and along them. Each one is merged into the same outline as the branch it grows from — unless it would be swallowed doing it, in which case it is engraved instead."
                    checked={p.leaves}
                    onChange={b => params.set({ leaves: b }, { label: "Leaves" })}
                />
                {p.leaves && (
                    <>
                        <SliderField
                            label="Leaf count"
                            hint="How many to hang. They are spread across the twigs rather than piled onto the first few: a candidate closer than a leaf-and-a-bit to one already drawn is passed over for the next one, so raising this fills the canopy instead of thickening the clumps. If the twigs run out of room the tool draws what fits and says so."
                            value={p.leafCount}
                            min={0}
                            max={200}
                            step={1}
                            unit=""
                            onChange={n => params.set({ leafCount: Math.round(n) }, { label: "Leaf count", coalesce: "leafCount" })}
                        />
                        <SliderField
                            label="Leaf size"
                            hint={`Along the long axis. There is a floor of ${L.minLeaf} mm and it is enforced rather than suggested: the beam and the char it leaves are each about a tenth of a millimetre, so a leaf much smaller than that is a hole the size of the hole that made it. Ask for less and the tool grows them and says so.`}
                            value={p.leafSize}
                            min={1}
                            max={30}
                            step={0.5}
                            onChange={n => params.set({ leafSize: n }, { label: "Leaf size", coalesce: "leafSize" })}
                        />
                        {result && (
                            <p className="text-[11px] leading-relaxed text-subtle-foreground">
                                {result.tree.leafCount} cut into the outline, {result.tree.markCount} engraved. A leaf
                                that overlaps a branch, the frame or another leaf loses its own edge in the union, so
                                it is drawn in green instead of cut — the detail survives and nothing is cut twice.
                            </p>
                        )}
                    </>
                )}
            </PanelSection>

            {/* ── Getting it off the screen ──────────────────────────────── */}
            <PanelSection id="celtic-export" title="Export" icon={<Download className="size-3" />}>
                <ToggleField
                    label="Tabs and feet"
                    hint="Two tabs under the disc and two slotted feet for them to drop into. The tabs are merged into the disc's own outline rather than glued on afterwards, so they come out as part of the same piece; the feet are a second small file."
                    checked={p.base}
                    onChange={b => params.set({ base: b }, { label: "Base" })}
                />
                <ToggleField
                    label="Backing disc"
                    hint="A plain disc the same size, with the same tabs, to stand directly behind the tree. The openwork shows whatever is behind it, and a contrasting sheet turns that from the wall into part of the design."
                    checked={p.backing}
                    onChange={b => params.set({ backing: b }, { label: "Backing disc" })}
                />
                {(p.base || p.backing) && (
                    <>
                        <SliderField
                            label="Thickness"
                            hint="The sheet it is all cut from. The slot in each foot is exactly this wide plus the kerf, so measure the actual board rather than trusting what it was sold as — 3 mm ply is rarely 3 mm."
                            value={p.thickness}
                            min={0.8}
                            max={12}
                            step={0.1}
                            onChange={n => params.set({ thickness: n }, { label: "Thickness", coalesce: "thickness" })}
                        />
                        <SliderField
                            label="Kerf"
                            hint="How much width the beam burns away. Added to the slot in the foot, because a slot cut to the nominal thickness is a slot the tab does not go into."
                            value={p.kerf}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={n => params.set({ kerf: n }, { label: "Kerf", coalesce: "kerf" })}
                        />
                    </>
                )}
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Everything goes out as a hairline: 0.1 mm stroke, no fill, and the holes written as subpaths of the
                    same path under the even-odd rule, so a hole stays a hole in anything that opens it. The engraved
                    leaves are their own green layer.
                </p>
            </PanelSection>
        </Workspace>
    );
}
