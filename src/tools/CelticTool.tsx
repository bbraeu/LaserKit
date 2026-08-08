import { useCallback, useMemo } from "react";
import { CircleDashed, Dices, Footprints, Ruler, Sprout } from "lucide-react";
import { CELTIC_LIMITS, buildCelticTree, leafRing } from "../lib/celtic";
import type { BorderStyle, CelticOptions, CelticResult } from "../lib/celtic";
import { circleRing } from "../lib/design";
import { OPERATION_COLORS } from "../lib/dxf";
import type { Point } from "../lib/dxf";
import type { TextLayer } from "../lib/text";
import { buildTrace, prepareTrace } from "../lib/trace";
import type { TraceImage } from "../lib/trace";
import { framedToDxf, framedToFds, framedToSvg } from "../lib/wordsearch";
import type { Framed } from "../lib/wordsearch";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Preview } from "../workspace/Preview";
import { Workspace } from "../workspace/Workspace";
import { Field, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { NumberField } from "../workspace/fields/NumberField";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// The Celtic tree of life.
//
// Everything interesting about this tool is in one decision, and it is not a
// control: **the cut layer is a raster union**.
//
// A tree of life is branches crossing a trunk, crossing each other, crossing
// their own leaves and running into a ring. Drawn honestly as outlines, every
// one of those crossings is a pair of cut lines through both shapes, and the
// piece comes off the bed as confetti. So `buildCelticTree` hands back
// centrelines with widths rather than outlines, and this file paints the lot —
// strokes, leaves, the border band, the tabs — onto a canvas and traces the
// result exactly once. What comes back is the silhouette of the union: no
// seams, and the only closed curves in the export are the real edge of the real
// piece and the real holes between the branches.
//
// That is the same trick the curved text uses (see traceEachGlyph in
// src/lib/text.ts) and for the same reason, which is why the tracer is reached
// for here rather than a polygon-clipping library being added for the occasion.
//
// The one thing that must *not* go into the union is the border decoration. A
// braid engraved inside the band is a picture on the material; painted into the
// silhouette it would become holes, and a band with holes in it is a band that
// is not there. So it is a separate engraved layer, and it is the only thing in
// the drawing that is not red.
// ---------------------------------------------------------------------------

const L = CELTIC_LIMITS;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/**
 * How finely the union is painted, in pixels per millimetre.
 *
 * The trace is only ever as true as the raster under it, so this is the
 * accuracy of every cut line the tool writes: at 8 px/mm an edge can sit an
 * eighth of a millimetre from where the geometry put it, which is under the
 * kerf and therefore under anything you could measure on the finished piece.
 */
const PX_PER_MM = 8;

/**
 * Longest side of the raster.
 *
 * The same budget the image tracer uses, for the same reason: decomposing a
 * bitmap is linear in its pixels, and a 600 mm disc at 8 px/mm would be a
 * 23-megapixel canvas built on every keystroke. Past the cap the resolution
 * comes down rather than the drawing being cropped — a big disc is a big disc,
 * and a tenth of a millimetre matters less on one.
 */
const MAX_PX = 1600;

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
    // Three ways at each fork, four levels deep: 121 limbs, which fills a disc
    // without the outer two levels lying on top of each other.
    branches: 5,
    depth: 4,
    twist: 0.5,
    trunk: 8,
    leaves: true,
    leafSize: 7,
    roots: true,
    // A braid rather than a plain band: it is what makes the thing read as
    // Celtic rather than as a tree in a hoop, and it is engraved, so it costs
    // no strength.
    border: "braid",
    borderWidth: 10,
    base: true,
    thickness: 3,
    kerf: 0.15,
    seed: 1,
    backing: false
};

const BORDERS = [
    { id: "none" as const, label: "None", hint: "No ring at all. The branches then end in mid-air, which engraves beautifully and cuts badly — there is no rim to pick the piece up by and every twig is a cantilever." },
    { id: "plain" as const, label: "Plain", hint: "A bare band. The strongest of the four and the dullest: nothing is engraved into it, so the whole width is material." },
    { id: "braid" as const, label: "Braid", hint: "Two strands weaving across each other, engraved into the band. The classic border, and the one that reads at any size." },
    { id: "rope" as const, label: "Rope", hint: "Three strands at even phase — a cable rather than a plait. Denser than the braid, so it wants a wider band to stay readable." },
    { id: "knot" as const, label: "Knot", hint: "The braid with a small ring engraved at every crossing. That detail is what makes it read as knotwork instead of as a sine wave, and it is the first thing to turn to a smudge in a narrow band." }
];

const PRESETS: Preset<CelticParams>[] = [
    {
        id: "wreath",
        label: "Braided wreath",
        hint: "A 150 mm disc with roots, leaves and a braid",
        patch: { size: 150, branches: 3, depth: 4, leaves: true, leafSize: 7, roots: true, border: "braid", borderWidth: 10 }
    },
    {
        id: "knotwork",
        label: "Knotwork rim",
        hint: "A wide band with a ring at every crossing",
        patch: { size: 200, border: "knot", borderWidth: 18, branches: 3, depth: 4, leaves: true, leafSize: 9 }
    },
    {
        id: "winter",
        label: "Winter tree",
        hint: "No leaves, one more level of twigs",
        patch: { leaves: false, depth: 5, branches: 2, twist: 0.7, border: "plain", borderWidth: 8 }
    },
    {
        id: "stand",
        label: "Standing set",
        hint: "Tabs, two feet and a disc to go behind it",
        patch: { base: true, backing: true, border: "rope", borderWidth: 12, size: 180 }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

/** Lay a closed ring of millimetres onto the context as a path. */
const ringPath = (ctx: CanvasRenderingContext2D, a: Point[]): void => {
    ctx.beginPath();
    a.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
};

/** A canvas in millimetre coordinates, black on transparent, ready to paint on. */
const sheet = (widthMm: number, heightMm: number): { ctx: CanvasRenderingContext2D; w: number; h: number; ppmm: number } => {
    const ppmm = Math.min(PX_PER_MM, MAX_PX / Math.max(1, widthMm, heightMm)),
        w = Math.max(2, Math.ceil(widthMm * ppmm)),
        h = Math.max(2, Math.ceil(heightMm * ppmm)),
        canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser has no 2D canvas, and the overlapping branches can only be merged on one.");
    canvas.width = w;
    canvas.height = h;
    // Everything below is written in millimetres. Left on transparent black,
    // because the mask is read off the alpha channel — see prepareTrace's
    // `alpha` option — so undrawn canvas stays background instead of becoming
    // the solid black that a cleared 2D context technically holds.
    ctx.scale(ppmm, ppmm);
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return { ctx, w, h, ppmm };
};

/** Trace what has been painted, once, into closed rings in millimetres. */
const traceSheet = (ctx: CanvasRenderingContext2D, w: number, h: number, ppmm: number): Point[][] => {
    const img: TraceImage = {
        width: w,
        height: h,
        rgba: ctx.getImageData(0, 0, w, h).data,
        sourceWidth: w,
        sourceHeight: h,
        href: "",
        mode: "outline"
    };
    const traced = buildTrace(img, prepareTrace(img, { mode: "outline", threshold: 128, invert: false, alpha: true }), {
        // Anything enclosing less than about a third of a millimetre square is
        // a speck of antialiasing, not a hole in the tree.
        minArea: Math.max(3, (0.3 * ppmm) ** 2),
        // A tree has no corners in it. Rounding every vertex it can is both
        // what the shape wants and what keeps the node count down.
        smooth: 1,
        optimize: 0.5,
        prune: 0,
        style: "stroke",
        widthMm: w / ppmm
    });
    return traced.aSub.filter(s => s.points.length >= 3).map(s => s.points);
};

/**
 * The whole cut piece as one silhouette.
 *
 * Painted in the order it is built rather than in any clever order: the union
 * of a set of shapes does not care which went down first, which is exactly the
 * property that makes this worth doing.
 */
const unionOf = (r: CelticResult): Point[][] => {
    const { ctx, w, h, ppmm } = sheet(r.size, r.height),
        c = r.size / 2;

    if (r.ring) {
        // The band as one annulus: the outer circle one way round and the inner
        // the other, so the non-zero rule leaves the middle empty. Filling two
        // separate circles would fill the middle back in.
        ctx.beginPath();
        ctx.arc(c, c, r.ring.outer, 0, 2 * Math.PI);
        ctx.arc(c, c, r.ring.inner, 0, 2 * Math.PI, true);
        ctx.fill();
    }

    // Round caps and round joins, so a branch meets its parent as a fillet
    // rather than as a mitred corner that would show as a nick in the trace.
    for (const s of r.aStroke) {
        ctx.lineWidth = Math.max(0.05, s.width);
        ctx.beginPath();
        s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
    }

    for (const leaf of r.aLeaf) {
        ringPath(ctx, leafRing(leaf));
        ctx.fill();
    }
    for (const a of r.aTab) {
        ringPath(ctx, a);
        ctx.fill();
    }

    return traceSheet(ctx, w, h, ppmm);
};

/**
 * The plain disc that goes behind it.
 *
 * With no tabs this is one circle, and one circle needs no raster: tracing it
 * would only make it very slightly less round than the exact ring already is.
 * With tabs it is a circle overlapping two rectangles, which is the same
 * problem as everything else here and gets the same answer.
 */
const backingOf = (r: CelticResult): Point[][] => {
    const c = r.size / 2;
    if (!r.aTab.length) return [circleRing(c, c, r.size / 2)];

    const { ctx, w, h, ppmm } = sheet(r.size, r.height);
    ctx.beginPath();
    ctx.arc(c, c, r.size / 2, 0, 2 * Math.PI);
    ctx.fill();
    for (const a of r.aTab) {
        ringPath(ctx, a);
        ctx.fill();
    }
    return traceSheet(ctx, w, h, ppmm);
};

const framedOf = (aLayer: TextLayer[], width: number, height: number): Framed => ({ aLayer, width, height });

export default function CelticTool() {
    const params = useHistoryParams<CelticParams>(DEFAULTS, { storageKey: "laserkit:params:celtic" });
    const p = params.value;

    const build = useCallback((o: CelticParams) => {
        const tree = buildCelticTree(o),
            aLayer: TextLayer[] = [{ operation: CUT, rings: unionOf(tree), filled: false }];

        // The decoration is engraved and never painted into the union — see the
        // note at the top of this file.
        if (tree.aBorderLine.length) {
            aLayer.push({ operation: MARK, rings: tree.aBorderLine, filled: false });
        }

        const design = framedOf(aLayer, tree.size, tree.height),
            feet = tree.feet
                ? framedOf([{ operation: CUT, rings: tree.feet.rings, filled: false }], tree.feet.width, tree.feet.height)
                : null,
            backing = o.backing
                ? framedOf([{ operation: CUT, rings: backingOf(tree), filled: false }], tree.size, tree.height)
                : null;

        return {
            tree,
            design,
            preview: framedToSvg(design),
            feet,
            backing,
            pieces: aLayer[0]!.rings.length
        };
    }, []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        // The tabs make the piece taller than it is wide, so switching the base
        // on is a different drawing and deserves a refit.
        fitKey: `${p.size}|${p.base}`,
        fallbackError: "This tree could not be turned into geometry.",
        // A raster union and a trace on every change: the second most expensive
        // build in the kit, after the calendar's twelve.
        delay: 260
    });

    const stem = useMemo(
        () => `celtic_tree_${Math.round(p.size)}mm_${p.branches}x${p.depth}_${p.seed}`,
        [p.size, p.branches, p.depth, p.seed]
    );

    const exports: ExportItem[] = useMemo(() => {
        if (!result) return [];
        return [
            ...designExports({
                stem,
                eventPrefix: "CELTIC",
                build: fmt => fmt === "fds"
                    ? framedToFds(result.design)
                    : textBlob(fmt === "dxf" ? framedToDxf(result.design) : framedToSvg(result.design), fmt)
            }),
            ...(result.feet ? [{
                id: "feet",
                label: "Feet",
                desc: `Two feet ${mm(result.feet.width)} × ${mm(result.feet.height)}, slotted for a ${mm(p.thickness)} sheet with the kerf already added`,
                filename: `${stem}_feet.svg`,
                blob: () => textBlob(framedToSvg(result.feet!), "svg"),
                event: "CELTIC_FEET_Download",
                group: "extra" as const
            }] : []),
            ...(result.backing ? [{
                id: "backing",
                label: "Backing disc",
                desc: `A plain ⌀ ${mm(result.tree.size)} disc to go behind the openwork, tabs and all`,
                filename: `${stem}_backing.svg`,
                blob: () => textBlob(framedToSvg(result.backing!), "svg"),
                event: "CELTIC_BACKING_Download",
                group: "extra" as const
            }] : [])
        ];
    }, [result, stem, p.thickness]);

    const legend: LegendItem[] = [
        { color: "#ff0000", label: "cut" },
        ...(p.border === "braid" || p.border === "rope" || p.border === "knot"
            ? [{ color: "#00a000", label: "engraved" }]
            : [])
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
                        svg={framedToSvg(result.feet)}
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
                        svg={framedToSvg(result.backing)}
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
            subtitle={result ? `${result.tree.branchCount} branches · ${result.tree.leafCount} leaves` : undefined}
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
                { label: "Leaves", value: String(result.tree.leafCount) },
                {
                    label: "Thinnest twig",
                    value: `${result.tree.thinnest.toFixed(2)} mm`,
                    hint: "The narrowest stroke in the drawing, which is the first thing to snap. Under a millimetre it goes while you are lifting the piece off the bed; under two it is delicate in anything but plywood. Raise the trunk width or take a level off the depth."
                },
                {
                    label: "Cut paths",
                    value: String(result.pieces),
                    hint: "Closed cut lines in the export. Because everything is painted and traced as one silhouette, this counts the real edge of the piece and the real holes between the branches — never a seam where two branches happen to overlap."
                },
                {
                    label: "Leaf size",
                    value: `${result.tree.leafSize.toFixed(1)} mm`,
                    hint: `What the leaves actually came out at, which is never below ${L.minLeaf} mm however small they were asked for. Under that a cut leaf is a hole the size of the beam plus its own char, and forty of them are a grey smudge rather than a canopy.`
                }
            ] : []}
            warnings={result?.tree.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? framedToSvg(result.design) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "celtic-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
            bottomPanels={bottomPanels.length ? bottomPanels : undefined}
        >
            {/* ── How big, and which tree ────────────────────────────────── */}
            <PanelSection id="celtic-shape" title="Shape" icon={<Ruler className="size-3" />}>
                <SliderField
                    label="Diameter"
                    hint="The whole disc. Everything else is a fraction of it, so the tree is the same tree at 60 mm and at 300 — but the twigs are not, because they get thinner as the disc gets smaller."
                    value={p.size}
                    min={L.minSize}
                    max={400}
                    onChange={n => params.set({ size: n }, { label: "Diameter", coalesce: "size" })}
                />
                <SliderField
                    label="Trunk width"
                    hint="The trunk, in millimetres. Every branch is a fraction of it and every twig a fraction of that, so this is the one number that decides whether the outer twigs survive being lifted off the bed."
                    value={p.trunk}
                    min={1}
                    max={40}
                    step={0.5}
                    onChange={n => params.set({ trunk: n }, { label: "Trunk width", coalesce: "trunk" })}
                />
                <SliderField
                    label="Wander"
                    hint="How far a branch bends off straight, and how far the children fan out from their parent. At zero it is a diagram of a tree; at one it is a bramble. The middle is where it looks grown."
                    value={p.twist}
                    min={0}
                    max={1}
                    step={0.05}
                    unit=""
                    onChange={n => params.set({ twist: n }, { label: "Wander", coalesce: "twist" })}
                />
                <Field
                    label="Seed"
                    hint="Which tree this is. Every bend and every leaf comes from it, so the same seed always gives the same tree — go back to the number and you go back to the tree."
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
                    >
                        <Dices className="size-3.5" />
                        Another tree
                    </button>
                </Field>
            </PanelSection>

            {/* ── How much of it there is ────────────────────────────────── */}
            <PanelSection id="celtic-growth" title="Growth" icon={<Sprout className="size-3" />}>
                <SliderField
                    label="Branches"
                    hint="How many ways each limb splits. Two is a tree, five is a canopy — and the count multiplies with the depth, so five ways at six levels is tens of thousands of limbs lying on top of each other."
                    value={p.branches}
                    min={L.minBranches}
                    max={L.maxBranches}
                    step={1}
                    unit="×"
                    onChange={n => params.set({ branches: Math.round(n) }, { label: "Branches", coalesce: "branches" })}
                />
                <SliderField
                    label="Depth"
                    hint="How many times it splits before it stops. Each level covers about half the distance left to the ring, so more levels is a finer canopy rather than a bigger one — and each is 72 % of its parent's width, which is where the thinnest twig comes from."
                    value={p.depth}
                    min={L.minDepth}
                    max={L.maxDepth}
                    step={1}
                    unit=""
                    onChange={n => params.set({ depth: Math.round(n) }, { label: "Depth", coalesce: "depth" })}
                />
                <ToggleField
                    label="Roots"
                    hint="Roots below, mirroring the branches above and reaching the ring too, so the disc is held from underneath as well as over the top. Off, the trunk simply runs down into the band on its own."
                    checked={p.roots}
                    onChange={b => params.set({ roots: b }, { label: "Roots" })}
                />
                <ToggleField
                    label="Leaves"
                    hint="Leaves on the outer twigs, painted into the same silhouette as everything else — so a leaf overlapping a branch is one shape, not two cut lines crossing."
                    checked={p.leaves}
                    onChange={b => params.set({ leaves: b }, { label: "Leaves" })}
                />
                {p.leaves && (
                    <SliderField
                        label="Leaf size"
                        hint={`Along the long axis. There is a floor of ${L.minLeaf} mm and it is enforced rather than suggested: the beam and the char it leaves are each about a tenth of a millimetre, so a leaf much smaller than that is a hole the size of the hole that made it. Ask for less and the tool grows them and says so.`}
                        value={p.leafSize}
                        min={1}
                        max={30}
                        step={0.5}
                        onChange={n => params.set({ leafSize: n }, { label: "Leaf size", coalesce: "leafSize" })}
                    />
                )}
            </PanelSection>

            {/* ── The ring it grows into ─────────────────────────────────── */}
            <PanelSection id="celtic-border" title="Border" icon={<CircleDashed className="size-3" />}>
                <SelectField
                    label="Style"
                    hint={BORDERS.find(o => o.id === p.border)!.hint}
                    value={p.border}
                    choices={BORDERS}
                    onChange={(v: BorderStyle) => params.set({ border: v }, { label: "Border style" })}
                />
                {p.border !== "none" && (
                    <SliderField
                        label="Border width"
                        hint="How wide the band is. This is the whole edge of the piece and everything hangs off it — the branches and the roots both grow into it, and the tabs hang from it. Under 2 mm it is a wire."
                        value={p.borderWidth}
                        min={1}
                        max={Math.max(2, Math.round(p.size * 0.25))}
                        step={0.5}
                        onChange={n => params.set({ borderWidth: n }, { label: "Border width", coalesce: "borderWidth" })}
                    />
                )}
                {p.border === "none" && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        With no ring the branches stop just short of the edge and end in mid-air. Handsome engraved
                        onto a board; as a cut piece it has nothing holding it together.
                    </p>
                )}
            </PanelSection>

            {/* ── Standing it up ─────────────────────────────────────────── */}
            <PanelSection id="celtic-base" title="Base" icon={<Footprints className="size-3" />}>
                <ToggleField
                    label="Tabs and feet"
                    hint="Two tabs under the disc and two slotted feet for them to drop into. The tabs are painted into the disc's own outline rather than glued on afterwards, so they come out as part of the same piece; the feet are a second small file."
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
            </PanelSection>
        </Workspace>
    );
}
