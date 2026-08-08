import { subtract, union } from "./boolean";
import type { Region } from "./boolean";
import { pathData, r3 } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Point } from "./dxf";
import { buildFds } from "./fds";
import { placeShape, shapeById } from "./shapes";
import type { ShapeId } from "./shapes";

// ---------------------------------------------------------------------------
// The interlocking engine.
//
// A mandala here is a stack of rings; a ring is one shape repeated round a
// circle. That much is the same as the parametric generator next door. What is
// different — and what the whole file is for — is that the copies are *allowed
// to overlap*, both their neighbours on the same ring and the rings above and
// below, and the result is merged into one outline before anybody sees it.
//
// That merge is not a finishing step, it is the design. Two circles that
// overlap are not two circles: they are a shape with a waist, and the void
// between three of them is a curved triangle nobody drew. Everything that makes
// a hand-drawn mandala look woven comes from shapes crossing each other, and
// the reason generators produce that flat "arranged on a grid" look is that
// they lay their motifs down side by side and stop.
//
// Two consequences worth stating up front.
//
// The first is that overlap and cutting are the same question. Two shapes drawn
// as outlines that cross are, to a laser, four cuts and two loose pieces. So the
// union is not optional and is not a preview mode: it is what gets exported,
// and it is why this file depends on real polygon booleans rather than on
// painting the drawing into a canvas and tracing it back out.
//
// The second is that "how big" and "how far apart" are one degree of freedom
// unless something is done about it. On a ring with a fixed count at a fixed
// radius the centres are exactly where they are, so the only thing that can
// change the gap between two neighbours is how wide they are — which means a
// uniform size slider is secretly a spacing slider as well, and two controls
// that fight each other is worse than one.
//
// So a copy is scaled along the radius and across it separately. `size` is how
// far the ring reaches outwards; `spread` is how much of its own slot the copy
// takes across, where the slot is that copy's share of the circumference. One
// is the shape, the other is the weave, and moving either leaves the other
// alone.
// ---------------------------------------------------------------------------

export const INTERLOCK_LIMITS = {
    minSize: 20,
    maxSize: 1000,
    minCount: 1,
    maxCount: 64,
    maxRings: 8
} as const;

export interface InterlockRing {
    shape: ShapeId;
    /** how many copies go round the circle */
    count: number;
    /** where the middle of a copy sits, as a share of the disc's radius */
    radius: number;
    /** how far the copy reaches outwards, as a share of the disc's radius */
    size: number;
    /** the copy's own turn, degrees — 0 points outwards */
    spin: number;
    /**
     * How much room each copy is given, as a multiple of what it needs to touch
     * its neighbours.
     *
     * 1 is touching. Below 1 they interlock — 0.5 means each copy is twice as
     * wide as its share of the circle, so it laps half-way over the one beside
     * it. Above 1 they separate.
     *
     * It works by setting the copy's width *across* the ring while `size` sets
     * how far it reaches *outwards*, which is the only way the two can be
     * separate controls at all: with the count and the radius fixed, the
     * centres are where they are, so the sole thing that can change the gap
     * between two neighbours is how wide they are. Scale uniformly and every
     * size slider is secretly a spacing slider too.
     */
    spread: number;
    /**
     * How far the ring is pushed into its neighbours, as a share of its own
     * size. Positive goes outwards.
     *
     * The vertical half of interlocking. Two rings that merely sit one outside
     * the other read as two bracelets; push one a third of a shape into the
     * other and they read as a weave.
     */
    interlock: number;
    /** turn the whole ring, degrees — what staggers one ring against the next */
    phase: number;
    /** leave the ring out without losing its settings */
    on: boolean;
}

export interface InterlockOptions {
    /** the outer diameter, mm */
    size: number;
    aRing: InterlockRing[];
    /** a plain disc in the middle, as a share of the radius */
    hub: number;
    /** a hole through the middle to hang it by, mm */
    hole: number;
    /** cut the outer circle */
    outline: boolean;
}

export interface InterlockResult {
    /** the merged drawing: outlines and their holes */
    regions: Region[];
    width: number;
    height: number;
    /** how many copies were placed, before anything merged */
    stamps: number;
    /** how many separate pieces the drawing would come off the bed as */
    pieces: number;
    /** closed contours in the export, holes included */
    contours: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 100) / 100} mm`;

const TAU = Math.PI * 2;

/** A circle as a polygon, phase-shifted so no two of them share a vertex. */
const disc = (cx: number, cy: number, r: number, phase = 0, segs = 128): Point[] =>
    Array.from({ length: segs }, (_, i) => {
        const a = (TAU * i) / segs + phase;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

export const defaultRing = (shape: ShapeId, radius: number): InterlockRing => ({
    shape,
    count: 12,
    radius,
    size: 0.3,
    spin: 0,
    spread: 0.75,
    interlock: 0,
    phase: 0,
    on: true
});

/**
 * How wide one copy has to be for its neighbours to exactly touch it.
 *
 * The slot: `count` copies share a circle of circumference 2πr, so each gets
 * `2πr/count` of arc to itself. Made a shade generous, because the shape is
 * straight and the arc is curved, so two shapes whose arc-widths just meet
 * still have a hair of daylight between their flat edges.
 */
const slotWidth = (count: number, radius: number): number =>
    (TAU * Math.max(0, radius)) / Math.max(1, Math.round(count));

/** Every copy on one ring, placed but not yet merged. */
export const ringRegions = (o: InterlockRing, R: number, centre: Point): Region[] => {
    const def = shapeById(o.shape),
        count = Math.round(clamp(o.count, INTERLOCK_LIMITS.minCount, INTERLOCK_LIMITS.maxCount)),
        radius = clamp(o.radius, 0, 1.4) * R,
        // How far the shape reaches outwards. Absolute, and independent of
        // everything below.
        length = clamp(o.size, 0.01, 1.2) * R,
        // How far it reaches across, and therefore how much of its neighbour it
        // covers. `spread` divides the slot, so 1 is exactly touching, a half
        // is twice as wide as its share and laps half over the shape beside it,
        // and 2 leaves a shape half the width of its slot with daylight either
        // side. Low values interlock, which is what the slider says.
        width = slotWidth(count, radius) / clamp(o.spread, 0.08, 4),
        // Pushed towards the next ring out, or the one in — a share of the
        // shape's own reach, so the control means the same thing on a ring of
        // 5 mm dots as on a ring of 40 mm petals.
        pushed = radius + clamp(o.interlock, -1, 1) * length * 0.5,
        phase = (clamp(o.phase, -360, 360) * Math.PI) / 180,
        spin = (clamp(o.spin, -360, 360) * Math.PI) / 180;

    // A ring at radius zero is one shape sitting in the middle, not `count` of
    // them stacked on the same spot — the slot has no width there, so every
    // copy would be a sliver.
    if (radius < 1e-6) return [placeShape(def, centre, 0, phase, length, length * def.aspect, spin)];

    return Array.from({ length: count }, (_, k) =>
        placeShape(def, centre, pushed, phase + (TAU * k) / count, length, width, spin));
};

/**
 * The whole drawing, merged.
 *
 * Everything is unioned in one sweep rather than ring by ring, because a ring
 * pushed into its neighbour has to merge with that neighbour and a two-stage
 * merge would have to know which pairs touch. The library is happy with a few
 * hundred polygons; what it is not happy with is perfectly symmetric input,
 * which is exactly what a mandala is — see `nudge` in boolean.ts for the
 * ladder that deals with it.
 */
export const buildInterlock = (opt: InterlockOptions): InterlockResult => {
    const L = INTERLOCK_LIMITS,
        warnings: string[] = [],
        size = clamp(opt.size, L.minSize, L.maxSize),
        R = size / 2,
        centre: Point = { x: R, y: R },
        aRing = opt.aRing.filter(o => o.on).slice(0, L.maxRings);

    const aStamp: Region[] = [];
    for (const ring of aRing) aStamp.push(...ringRegions(ring, R, centre));

    const hub = clamp(opt.hub, 0, 0.9) * R;
    if (hub > 0) aStamp.push({ rings: [disc(centre.x, centre.y, hub, 0.013)] });

    let regions = aStamp.length ? union(aStamp) : [];

    // The hanging hole is taken *out* rather than drawn on top: a circle drawn
    // over the design is a second cut that crosses whatever is under it, and
    // what falls out of the middle then is not a disc, it is the middle of the
    // mandala.
    const hole = clamp(opt.hole, 0, R);
    if (hole > 0 && regions.length) {
        regions = subtract(regions, [{ rings: [disc(centre.x, centre.y, hole / 2, 0.021)] }]);
    }

    if (opt.outline) {
        regions = union([...regions, { rings: [disc(centre.x, centre.y, R, 0.007)] }]);
    }

    // ── what it will do on the bed ──────────────────────────────────────
    //
    // The two numbers worth putting in front of somebody. `pieces` is how many
    // separate things come off the bed: a mandala is meant to be one. Anything
    // that did not reach its neighbours is its own piece and will be lying
    // loose under the honeycomb.
    const pieces = regions.length,
        contours = regions.reduce((s, o) => s + o.rings.length, 0);

    if (aStamp.length === 0) {
        warnings.push("Every ring is switched off, so there is nothing to cut.");
    } else if (pieces > 1) {
        warnings.push(
            `This comes off the bed as ${pieces} separate pieces. Rings that do not reach each other are not `
            + "joined — lower the spacing so the shapes on a ring overlap, or use the interlock slider to push a "
            + "ring into the one next to it."
        );
    }
    if (contours > 600) {
        warnings.push(
            `${contours} closed contours is a long cut and a lot of file. Most of them are the little voids between `
            + "overlapping shapes; raising the spacing a little merges them away."
        );
    }
    if (hole > 0 && hole / 2 > hub && hub > 0) {
        warnings.push("The hanging hole is bigger than the hub it is punched in, so it eats into the first ring.");
    }
    if (opt.outline && aRing.some(o => o.radius > 1)) {
        warnings.push(
            `A ring is set beyond the edge of the ${mm(size)} disc. It is merged into the rim rather than cut off, `
            + "which is usually not what was meant."
        );
    }

    return {
        regions,
        width: size,
        height: size,
        stamps: aStamp.length,
        pieces,
        contours,
        warnings
    };
};

// ---------------------------------------------------------------------------
// Laser-ready export
//
// Its own emitters rather than the shared ones, for two reasons that both come
// from this being a *cut* design rather than an engraved one.
//
// The stroke is a hairline — 0.1 mm, the width every cutter's importer reads as
// "this is a cut, not a shape". The shared emitter draws 0.3 mm because most of
// the kit's output is looked at as well as cut, and a hairline is invisible on
// screen at a sensible zoom.
//
// And the fill rule is even-odd, stated explicitly. Every region here is an
// outline with holes in it, and the holes are the whole design — the voids
// between overlapping shapes are what makes it look woven. Under the default
// non-zero rule, whether a hole is a hole depends on which way round its points
// happen to run, which is a property of the boolean library's internals rather
// than of the drawing. Even-odd does not care about winding, so a hole is a
// hole because it is inside something, which is the only definition anybody
// means.
// ---------------------------------------------------------------------------

/** How a cut line is written, in mm. Thin enough that an importer reads it as a cut. */
export const HAIRLINE = 0.1;

const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const FILL = OPERATION_COLORS.FILL_VECTOR_ENGRAVING!;

export interface ExportStyle {
    /**
     * Filled areas rather than outlines.
     *
     * The same geometry either way — what changes is what the machine is being
     * asked to do with it. Filled is for engraving the pattern into a surface;
     * outlined is for cutting it out.
     */
    engrave: boolean;
}

const pathOf = (r: InterlockResult): string =>
    r.regions.flatMap(o => o.rings).map(a => pathData(a, true)).join(" ");

export const interlockToSvg = (r: InterlockResult, style: ExportStyle): string => {
    const d = pathOf(r),
        paint = style.engrave
            ? `fill="${FILL.css}" fill-rule="evenodd"`
            : `fill="none" stroke="${CUT.css}" stroke-width="${HAIRLINE}" fill-rule="evenodd"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
        + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
        + (d ? `<path d="${d}" ${paint}/>` : "")
        + "</svg>";
};

export const interlockToDxf = (r: InterlockResult, style: ExportStyle): string => {
    const op = style.engrave ? FILL : CUT,
        aEntity: DxfEntity[] = r.regions.flatMap(o => o.rings.map(a => ({
            color: op.color,
            closed: true,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const interlockToFds = (r: InterlockResult, style: ExportStyle): Promise<Blob> =>
    buildFds([{
        // 0 is the filled mode and 2 the cut one — the same choice the SVG
        // makes with fill versus stroke, said in the machine's own vocabulary.
        mode: style.engrave ? 0 : 2,
        subpaths: r.regions.flatMap(o => o.rings.map(a => ({ points: a, closed: true })))
    }]);

/** The drawing as one path, for the canvas. */
export const interlockPreview = (r: InterlockResult, engrave: boolean): string => {
    const d = pathOf(r);
    if (!d) return `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm" viewBox="0 0 ${r3(r.width)} ${r3(r.height)}"></svg>`;
    // On screen the hairline is drawn a good deal fatter than it is exported at,
    // because 0.1 mm on a 200 mm disc is invisible until you zoom to 20×. The
    // export is the hairline; this is a picture of it.
    const paint = engrave
        ? `fill="${FILL.css}" fill-rule="evenodd"`
        : `fill="none" stroke="${CUT.css}" stroke-width="0.35" fill-rule="evenodd"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
        + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
        + `<path d="${d}" ${paint}/></svg>`;
};
