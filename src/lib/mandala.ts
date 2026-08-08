import { regionOf, ringsOf, union } from "./boolean";
import { arcSegments, circleRing, pathData, r3 } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Operation, Point } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Mandalas and sunbursts.
//
// A decorative tool, which means the only thing that matters is whether it
// comes out looking deliberate — and the way to get that is fewer controls that
// each move the whole drawing, not a slider per ring.
//
// There are two families of shape here, and the second exists because the first
// has a ceiling.
//
// A **band motif** occupies an angular slot of 2π/symmetry, spans a band of
// radius, and its half-angle at each point is
//
//     a(t) = aMax · f(t),   t = 0 at the inner edge, 1 at the outer
//
// where f is the only thing that differs between a petal, a spoke and a
// scallop. That is worth the constraint: four motifs written four times would
// drift, and four motifs sharing a sampler stay a set.
//
// But it is also the reason the first eight all looked related. One profile
// function is one closed curve, symmetric about its slot and convex — so it can
// be a petal, a lens, a rhombus or a slot, and it can never be a star, an arrow
// or a rosette. No amount of taste in f gets there; a star has two radii and an
// arrow is not symmetric end to end.
//
// So a **composed motif** is drawn in its own little coordinate system instead
// — see `motif space` below — where it is any number of closed rings, made of
// straight runs, arcs and thickened centrelines. Those are the shapes a
// clip-art mandala kit is full of, and they are what makes a ring read as
// designed rather than sampled.
//
// The one thing this tool has to be careful about is **cut** mandalas. A cut
// pattern is holes in a disc, and holes that meet each other separate the disc
// into pieces. Nothing on the canvas shows that — a mandala that will fall into
// forty petals looks exactly like one that will not. So the material left
// between motifs and between rings is computed from the parameters and reported
// in millimetres, and the tool complains long before it reaches zero.
// ---------------------------------------------------------------------------

const FILL = OPERATION_COLORS.FILL_VECTOR_ENGRAVING!;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

export const MANDALA_LIMITS = {
    minSize: 20,
    maxSize: 1000,
    minSymmetry: 3,
    maxSymmetry: 64,
    minRings: 1,
    maxRings: 10
} as const;

/**
 * What one repeat of a ring looks like.
 *
 * The set is not arbitrary. Every tutorial on drawing a mandala reaches for the
 * same handful — teardrops, pointed petals, dots, triangles, arcs, diamonds —
 * because they are the shapes that survive being repeated thirty times without
 * turning to mush, and `dots` is in there because a ring that is *not* a band
 * of motifs is what stops a mandala reading as a set of concentric fences.
 */
export type BandMotif = "petal" | "lotus" | "drop" | "spoke" | "scallop" | "diamond" | "dart";

/**
 * Motifs that are an assembly rather than one curve.
 *
 * These are the shapes a profile function cannot reach: a star alternates
 * between two radii, an arrow is not symmetric end to end, a rosette is seven
 * rings rather than one, and a Greek key is a line that turns corners.
 */
export type ComposedMotif =
    | "arrow" | "star" | "flower" | "paisley" | "crescent" | "chevron" | "fret"
    // The geometric family: the shapes every "how to build a mandala" sheet
    // opens with, and the ones a petal profile is furthest from being able to
    // draw.
    | "square" | "hexagon" | "star8" | "rings"
    // Fill and line work, which is what a mandala uses to make one band read as
    // quieter than the band next to it.
    | "lattice" | "hatch" | "ray"
    // Curves.
    | "spiral" | "scurve" | "vine";

export type Motif = BandMotif | ComposedMotif | "dots";

export type MandalaStyle = Motif | "mixed";

/** Burnt into the surface, or cut clean through. */
export type MandalaMode = "engrave" | "cut";

export interface MandalaOptions {
    /** outer diameter, mm */
    size: number;
    /** how many times each ring repeats round the circle */
    symmetry: number;
    rings: number;
    style: MandalaStyle;
    /**
     * Share of each motif's slot left as material, 0…0.8.
     *
     * This is the web between one motif and the next. On an engraved mandala it
     * is a look; on a cut one it is what holds the thing together.
     */
    gap: number;
    /** material between one ring and the next, mm */
    ringGap: number;
    /**
     * How much of its band's height a motif fills, 0.3…1.
     *
     * The other half of "space between the elements". `gap` opens them up
     * sideways, within their ring; this opens them up along the radius, by
     * leaving air at the inner and outer edge of every band. Both are needed:
     * a motif squeezed sideways but still touching its band's edges reads as
     * cramped whatever the symmetry.
     */
    bandFill: number;
    /**
     * A motif per ring, inside out, overriding the style.
     *
     * Null for the usual behaviour — one motif everywhere, or a seed picking
     * them. A mandala worth cutting is usually *stacked*: dots, then petals,
     * then a line of hatching, then rosettes. That is a decision per ring and
     * nothing else can express it.
     */
    layers: Motif[] | null;
    /** plain disc in the middle, as a share of the radius */
    hub: number;
    /** a hole through the middle to hang it by, mm — 0 for none */
    hole: number;
    /** a thin circle between one ring and the next */
    ringLines: boolean;
    /**
     * Draw the motifs as outlines rather than solid areas.
     *
     * This is what a mandala actually *is*. Every one ever drawn is line work —
     * the shapes are outlined and only then, sometimes, filled in — and solid
     * blobs are the single thing that makes a generated one look generated.
     * Engraved as lines it is also a fraction of the burn.
     */
    outlined: boolean;
    /**
     * A smaller copy of each motif inside itself.
     *
     * The other hallmark: "layered smaller petals, offset". One echo turns a
     * shape into a motif, and it costs nothing but a second ring.
     */
    nested: boolean;
    mode: MandalaMode;
    /** cut the outer circle */
    outline: boolean;
    /** which mandala this is, when the style is mixed */
    seed: number;
}

export interface MandalaLayer {
    operation: Operation;
    rings: Point[][];
    filled: boolean;
}

export interface MandalaResult {
    preview: string;
    aLayer: MandalaLayer[];
    width: number;
    height: number;
    /**
     * Motifs, all rings together — shapes, not rings of geometry.
     *
     * A nested echo is part of its motif rather than another one, and a dot is
     * one motif. Counting rings instead would say a mandala had twice as many
     * motifs the moment the echo was switched on, which is not a thing anybody
     * means by the word.
     */
    motifs: number;
    /** the narrowest material left between two motifs, mm */
    web: number;
    /** the material between rings, mm */
    ringWeb: number;
    /** which motif ended up in which ring, inside out */
    aMotifKind: Motif[];
    points: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 100) / 100} mm`;

const rng = (seed: number): (() => number) => {
    let a = (Math.floor(seed) || 1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * The half-angle profile of each motif, as a fraction of its widest.
 *
 * `t` runs 0 at the inner edge of the ring to 1 at the outer. Every one of them
 * is 0 at both ends, which is what closes the shape without a special case.
 */
const PROFILE: Record<BandMotif, (t: number) => number> = {
    // A lens: widest in the middle, pointed at both ends.
    petal: t => Math.sin(Math.PI * t),
    // The same, drawn out to a sharp point at each end. The classic lotus
    // petal, and the shape most people picture when they hear "mandala".
    lotus: t => Math.sin(Math.PI * t) ** 1.7,
    // Narrow at the hub and round at the rim, like a flame.
    drop: t => Math.sin(Math.PI * t) ** 0.6 * (0.35 + 0.65 * t),
    // Nearly parallel sides with rounded ends: a slot.
    spoke: t => Math.min(1, Math.sin(Math.PI * t) * 2.6),
    // Fat almost all the way, so the material between them is a thin rib.
    scallop: t => Math.sin(Math.PI * t) ** 0.4,
    // Straight sides to a point either side: a rhombus. The one angular shape
    // in the set, and the one that makes a ring read as geometry rather than
    // as flowers.
    diamond: t => 1 - Math.abs(2 * t - 1),
    // A triangle standing on the hub and widening to the rim.
    dart: t => t
};

// ---------------------------------------------------------------------------
// Motif space
//
// A composed motif is drawn in a little coordinate system of its own:
//
//     x   across the slot, 0 in the middle of it
//     y   out along the band, 0 at the inner edge and 1 at the outer
//
// Both axes are measured in **band heights**, so the space is isotropic: a
// circle of radius 0.2 authored here comes out as round on the disc as a shape
// on a curve can be. That is the whole reason for the indirection. The obvious
// alternative — author in the slot's own angular units — makes every shape a
// different proportion on every ring, so a star drawn once is a starfish on the
// inner ring and a snowflake on the outer.
//
// The map to the disc preserves arc length: a point at `x` sits `x · h` of
// millimetres round the circle from the motif's own centreline, whatever radius
// it is at. Straight runs come out very slightly bent, which is right — a motif
// that ignored the curve of its ring would look pasted on.
// ---------------------------------------------------------------------------

/** A point in motif space. */
interface UV {
    x: number;
    y: number;
}

/**
 * Half the width a motif may fill, in band heights.
 *
 * The same 0.42 the band motifs are capped at, so the two families come out the
 * same size — see `aspect` in `buildMandala` for why that number and not 0.5.
 */
const W = 0.42;

/** A closed circle in motif space. */
const uvCircle = (cx: number, cy: number, r: number, segs = 22): UV[] =>
    Array.from({ length: segs }, (_, i) => {
        const a = (2 * Math.PI * i) / segs;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

/** An open arc in motif space, for use as a centreline. */
const uvArc = (cx: number, cy: number, r: number, a0: number, a1: number, segs = 22): UV[] =>
    Array.from({ length: segs + 1 }, (_, i) => {
        const a = a0 + ((a1 - a0) * i) / segs;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

/**
 * Corners turned into short arcs.
 *
 * Needed before thickening anything with a bend in it: offsetting a polyline by
 * averaged vertex normals pinches at a sharp corner, and rounding the corner
 * first is both the cheap fix and what the shape wants anyway. A Greek key with
 * knife-edge corners is a diagram; one with a radius on them is a border.
 */
const roundCorners = (aPt: UV[], radius: number, segs = 5): UV[] => {
    if (aPt.length < 3) return aPt;
    const out: UV[] = [aPt[0]!];
    for (let i = 1; i < aPt.length - 1; i++) {
        const p = aPt[i]!,
            a = aPt[i - 1]!,
            b = aPt[i + 1]!,
            va = { x: a.x - p.x, y: a.y - p.y },
            vb = { x: b.x - p.x, y: b.y - p.y },
            la = Math.hypot(va.x, va.y) || 1,
            lb = Math.hypot(vb.x, vb.y) || 1,
            r = Math.min(radius, la / 2, lb / 2),
            pa = { x: p.x + (va.x / la) * r, y: p.y + (va.y / la) * r },
            pb = { x: p.x + (vb.x / lb) * r, y: p.y + (vb.y / lb) * r };
        out.push(pa);
        // A quadratic through the corner: two points and the corner itself are
        // all the control an arc of this size needs.
        for (let k = 1; k < segs; k++) {
            const t = k / segs,
                m = 1 - t;
            out.push({
                x: m * m * pa.x + 2 * m * t * p.x + t * t * pb.x,
                y: m * m * pa.y + 2 * m * t * p.y + t * t * pb.y
            });
        }
        out.push(pb);
    }
    out.push(aPt[aPt.length - 1]!);
    return out;
};

/**
 * A centreline given a width: the outline of a stroke, as a closed ring.
 *
 * Half the composed motifs are a line of some thickness — the crescent, the
 * chevron, the key, the tail of the paisley — and drawing each of those as an
 * explicit outline would be the same forty points written out twice, once
 * forwards and once backwards, with a sign error waiting in one of them.
 *
 * `width` is a function of the distance along, so a shape can taper: that is
 * what turns an arc into a moon with horns and a curve into a boteh.
 */
const ribbon = (aSpine: UV[], width: (s: number) => number, capStart = false): UV[] => {
    const n = aSpine.length;
    if (n < 2) return [];
    const normalAt = (i: number): UV => {
        const a = aSpine[Math.max(0, i - 1)]!,
            b = aSpine[Math.min(n - 1, i + 1)]!,
            dx = b.x - a.x,
            dy = b.y - a.y,
            len = Math.hypot(dx, dy) || 1;
        return { x: -dy / len, y: dx / len };
    };
    const left: UV[] = [],
        right: UV[] = [];
    for (let i = 0; i < n; i++) {
        const p = aSpine[i]!,
            hw = Math.max(0, width(i / (n - 1))) / 2,
            v = normalAt(i);
        left.push({ x: p.x + v.x * hw, y: p.y + v.y * hw });
        right.push({ x: p.x - v.x * hw, y: p.y - v.y * hw });
    }
    // A round end where the shape is meant to be blunt: a paisley's bulb is not
    // a chopped-off ribbon.
    const cap: UV[] = [];
    if (capStart) {
        const p = aSpine[0]!,
            hw = Math.max(0, width(0)) / 2,
            v = normalAt(0),
            a0 = Math.atan2(v.y, v.x);
        for (let k = 1; k < 10; k++) {
            const a = a0 + (Math.PI * k) / 10;
            cap.push({ x: p.x + hw * Math.cos(a), y: p.y + hw * Math.sin(a) });
        }
    }
    return [...left, ...right.reverse(), ...cap];
};

/** A star with two radii, its first point aimed out along the band. */
const uvStar = (cy: number, rOut: number, rIn: number, points: number): UV[] =>
    Array.from({ length: points * 2 }, (_, k) => {
        const th = (Math.PI * k) / points,
            r = k % 2 === 0 ? rOut : rIn;
        return { x: r * Math.sin(th), y: cy + r * Math.cos(th) };
    });

/** One petal of a rosette: a lens laid along a direction from the middle. */
const uvPetal = (cy: number, th: number, r0: number, r1: number, hw: number, segs = 12): UV[] => {
    const at = (s: number, side: number): UV => {
        const r = r0 + (r1 - r0) * s,
            off = side * hw * Math.sin(Math.PI * s);
        return {
            x: r * Math.sin(th) + off * Math.cos(th),
            y: cy + r * Math.cos(th) - off * Math.sin(th)
        };
    };
    const out: UV[] = [];
    for (let i = 0; i <= segs; i++) out.push(at(i / segs, +1));
    for (let i = segs; i >= 0; i--) out.push(at(i / segs, -1));
    return out;
};

/** A regular polygon with one vertex aimed out along the band. */
const uvPolygon = (cy: number, r: number, sides: number): UV[] =>
    Array.from({ length: sides }, (_, k) => {
        const th = (2 * Math.PI * k) / sides;
        return { x: r * Math.sin(th), y: cy + r * Math.cos(th) };
    });

/**
 * A line at 45° across a square, cut off at the square's edges.
 *
 * Needed for the lattice: hatching that runs past its own border is not a
 * lattice, it is a scribble with a box drawn round it. Written out rather than
 * reached for from a library because it is four candidate crossings and a
 * pick-the-two, and a general polygon clipper here would be a hundred lines
 * doing the same job worse.
 */
const diagonalIn = (cy: number, a: number, c: number, slope: 1 | -1): [UV, UV] | null => {
    const hit: UV[] = [];
    for (const x of [-a, a]) {
        const y = slope * x + c;
        if (Math.abs(y) <= a + 1e-9) hit.push({ x, y: cy + y });
    }
    for (const y of [-a, a]) {
        const x = (y - c) / slope;
        if (Math.abs(x) < a - 1e-9) hit.push({ x, y: cy + y });
    }
    if (hit.length < 2) return null;
    const p = hit[0]!,
        q = hit.reduce((best, o) => (Math.hypot(o.x - p.x, o.y - p.y) > Math.hypot(best.x - p.x, best.y - p.y) ? o : best), hit[1]!);
    return Math.hypot(q.x - p.x, q.y - p.y) < 0.02 ? null : [p, q];
};

/** An Archimedean spiral, as a centreline to be thickened. */
const uvSpiral = (cy: number, r0: number, r1: number, turns: number, segs = 60): UV[] =>
    Array.from({ length: segs + 1 }, (_, i) => {
        const t = i / segs,
            th = 2 * Math.PI * turns * t,
            r = r0 + (r1 - r0) * t;
        return { x: r * Math.sin(th), y: cy + r * Math.cos(th) };
    });

/** A composed motif, with what the layout needs to know about it. */
interface Composed {
    rings: UV[][];
    /**
     * Every point of it, as distance from the centreline and height up the
     * band.
     *
     * The whole shape, not just its widest point — because the widest point is
     * *not* where a motif comes closest to its neighbour. A point sits a fixed
     * number of millimetres round the circle from its own centreline whatever
     * radius it is at, so the angular room it eats grows as the radius shrinks:
     * the gap at a point is 2·(π/n·r − x·h), which falls as r falls. An arrow's
     * fletching is a little narrower than its head and much further in, and it
     * is the fletching that decides how close two arrows get.
     */
    aWide: UV[];
    /** the middle of its bounding box, which is what the echo shrinks about */
    midX: number;
    midY: number;
    /** whether a scaled copy inside itself adds anything, or it is busy already */
    echo: boolean;
}

/** The paisley's spine, which both its outline and its inner dot are hung on. */
const BOTEH = Array.from({ length: 20 }, (_, i) => {
    const s = i / 19;
    return { x: -0.09 + 0.40 * Math.sin(Math.PI * 0.60 * s), y: 0.17 + 0.72 * s };
});

const SHAPES: Record<ComposedMotif, UV[][]> = {
    // A shaft with a chevron head and a fletched tail. Angular, and the only
    // motif in the set that points — a ring of them reads as rotation, which
    // nothing made from a symmetric profile can do.
    arrow: [[
        { x: 0, y: 1 },
        { x: W, y: 0.62 }, { x: 0.15, y: 0.62 },
        { x: 0.15, y: 0.20 },
        { x: 0.33, y: 0.02 }, { x: 0, y: 0.21 }, { x: -0.33, y: 0.02 },
        { x: -0.15, y: 0.20 },
        { x: -0.15, y: 0.62 }, { x: -W, y: 0.62 }
    ]],
    // Five points, the first aimed at the rim.
    star: [uvStar(0.5, W, W * 0.42, 5)],
    // A rosette: six petals round a middle. The one motif that is unmistakably
    // an assembly, and the reason the whole indirection exists.
    flower: [
        ...Array.from({ length: 6 }, (_, k) => uvPetal(0.5, (k * Math.PI) / 3, 0.10, W, 0.105)),
        uvCircle(0, 0.5, 0.075)
    ],
    // A boteh: round at the bottom, curling to a point. Asymmetric on purpose —
    // it is the shape that most says "drawn by hand".
    paisley: [
        ribbon(BOTEH, s => 0.40 * (1 - s) ** 0.62, true),
        uvCircle(BOTEH[3]!.x, BOTEH[3]!.y, 0.085)
    ],
    // A moon: an arc thick in the middle and tapering to horns at both ends.
    crescent: [ribbon(uvArc(0.10, 0.5, 0.33, Math.PI * 0.62, Math.PI * 1.38, 20), s => 0.26 * Math.sin(Math.PI * s) ** 0.55)],
    // A V-bar. The running border every printed mandala has somewhere.
    chevron: [ribbon(roundCorners([{ x: -W, y: 0.16 }, { x: 0, y: 0.84 }, { x: W, y: 0.16 }], 0.10), () => 0.13)],
    // A Greek key. A line that turns four corners is not something a profile
    // function can express at all.
    fret: [ribbon(roundCorners([
        { x: -0.36, y: 0.14 },
        { x: 0.36, y: 0.14 },
        { x: 0.36, y: 0.86 },
        { x: -0.18, y: 0.86 },
        { x: -0.18, y: 0.40 },
        { x: 0.17, y: 0.40 },
        { x: 0.17, y: 0.63 }
    ], 0.055), () => 0.085)],

    // ── the geometric family ────────────────────────────────────────────
    //
    // The shapes every "how to build a mandala" sheet opens with. They are the
    // furthest thing from a petal profile there is: flat sides and corners, and
    // a fixed number of them.

    // Corners taken off, because a square with knife-edge corners in a ring of
    // twenty reads as a saw rather than as a row of squares.
    square: [roundCorners([
        { x: -W, y: 0.5 - W }, { x: W, y: 0.5 - W }, { x: W, y: 0.5 + W },
        { x: -W, y: 0.5 + W }, { x: -W, y: 0.5 - W }, { x: W, y: 0.5 - W }
    ], 0.09).slice(2, -2)],
    // Sized so it is exactly as wide as everything else: a hexagon on its point
    // is widest at its two shoulders, not at its vertices.
    hexagon: [uvPolygon(0.5, W / Math.sin(Math.PI / 3), 6)],
    // Eight points rather than five. The extra points mean shallower notches,
    // so it survives being repeated forty times where the five-pointed one
    // turns into a blur.
    star8: [uvStar(0.5, W, W * 0.46, 8)],
    // Two circles, one inside the other. The plainest motif in the set and the
    // one that does the most work: a ring of them between two busy bands is
    // what stops a mandala reading as one continuous texture.
    rings: [uvCircle(0, 0.5, W, 26), uvCircle(0, 0.5, W * 0.55, 20)],

    // ── fill and line work ──────────────────────────────────────────────
    //
    // Not shapes so much as textures. A mandala needs bands that are quieter
    // than their neighbours, and a band of pattern is quieter than a band of
    // figures.

    // Cross-hatch inside a border, clipped to it.
    lattice: [
        roundCorners([
            { x: -W, y: 0.5 - W }, { x: W, y: 0.5 - W }, { x: W, y: 0.5 + W },
            { x: -W, y: 0.5 + W }, { x: -W, y: 0.5 - W }, { x: W, y: 0.5 - W }
        ], 0.07).slice(2, -2),
        ...[-0.42, 0, 0.42].flatMap(c =>
            ([1, -1] as const)
                .map(slope => diagonalIn(0.5, W * 0.86, c, slope))
                .filter((o): o is [UV, UV] => o !== null)
                .map(([p, q]) => ribbon([p, q], () => 0.045)))
    ],
    // Parallel lines leaning across the slot. Straight radial ones would line
    // up with the neighbouring ring's and read as a fence; the lean is what
    // makes a band of them read as a twist.
    hatch: [-0.30, -0.15, 0, 0.15, 0.30].map(x0 =>
        ribbon([{ x: x0 - 0.09, y: 0.06 }, { x: x0 + 0.09, y: 0.94 }], () => 0.05)),
    // A spike from the inner edge to the outer with a lozenge near its end:
    // the radiating axis that a hand-drawn mandala uses to divide the ring
    // before anything is drawn in it.
    ray: [
        ribbon([{ x: 0, y: 0.04 }, { x: 0, y: 0.96 }], s => 0.11 * (1 - 0.82 * s) + 0.015),
        [
            { x: 0, y: 0.62 }, { x: W * 0.62, y: 0.78 }, { x: 0, y: 0.94 }, { x: -W * 0.62, y: 0.78 }
        ]
    ],

    // ── curves ──────────────────────────────────────────────────────────

    spiral: [ribbon(uvSpiral(0.5, 0.045, W, 2.6), () => 0.075)],
    // Two bends the same size in opposite directions. Alternate rings are
    // already turned half a slot, so a band of these reads as a running braid
    // without any of them touching.
    scurve: [ribbon(
        Array.from({ length: 30 }, (_, i) => {
            const s = i / 29;
            return { x: 0.30 * Math.sin(2 * Math.PI * s), y: 0.06 + 0.88 * s };
        }),
        s => 0.10 * Math.sin(Math.PI * s) ** 0.35 + 0.02
    )],
    // A stem with leaves alternating along it. The one motif here that is
    // deliberately not symmetric about anything, which is what makes a ring of
    // them read as growth rather than as pattern.
    vine: (() => {
        const stem = Array.from({ length: 26 }, (_, i) => {
            const s = i / 25;
            return { x: 0.20 * Math.sin(Math.PI * 1.15 * s) - 0.05, y: 0.05 + 0.90 * s };
        });
        const out: UV[][] = [ribbon(stem, s => 0.075 * (1 - 0.72 * s) + 0.012)];
        for (const [k, at] of [0.26, 0.50, 0.74, 0.94].entries()) {
            const i = Math.round(at * (stem.length - 1)),
                p = stem[i]!,
                q = stem[Math.max(0, i - 1)]!,
                along = Math.atan2(p.y - q.y, p.x - q.x),
                // Alternating sides, and swept back towards the stem's root the
                // way a real one grows.
                side = k % 2 === 0 ? 1 : -1,
                th = along + side * 1.15;
            out.push(uvPetal(0, th, 0.02, 0.20, 0.052, 10).map(o => ({ x: o.x + p.x, y: o.y + p.y })));
        }
        return out;
    })()
};

/**
 * Which composed motifs a smaller copy of themselves fits inside.
 *
 * Only the solid ones. A scaled copy of a *thin* shape does not land inside its
 * parent, it lands in the parent's hollow and crosses the outline on the way —
 * a half-size crescent sits in the bite of the moon, not in the moon. So the
 * echo is for the star and the arrow; the crescent, the chevron and the key are
 * already a line of constant thickness with nothing to nest into, and the
 * rosette and the paisley carry their own middles.
 */
const ECHOES: Record<ComposedMotif, boolean> = {
    star: true, arrow: true, square: true, hexagon: true, star8: true,
    // Every one of these is either a line of constant thickness or already has
    // something inside it.
    crescent: false, chevron: false, fret: false, flower: false, paisley: false,
    rings: false, lattice: false, hatch: false, ray: false,
    spiral: false, scurve: false, vine: false
};

/**
 * How tall a band each motif wants, relative to the others.
 *
 * Rings used to be given equal shares of the radius, and that is the single
 * thing that most made a generated mandala look generated. A hand-drawn one is
 * a stack of bands of *different* heights: a thread of dots, then a deep band
 * of lotus petals, then a narrow line of hatching, then rosettes. Equal bands
 * turn all of that into a set of concentric fences, and no choice of motif
 * rescues it — a ring of dots given the same height as a ring of rosettes is
 * mostly empty space, and the rosettes are cramped in exactly the same measure.
 *
 * So a motif asks for the room it needs and the ring heights follow.
 */
const WEIGHT: Record<Motif, number> = {
    // Punctuation: thin on purpose.
    dots: 0.45, hatch: 0.55, rings: 0.75, chevron: 0.7, ray: 0.8, fret: 0.9, crescent: 0.9,
    // The ordinary band motifs.
    petal: 1, lotus: 1.1, drop: 1, spoke: 1, scallop: 0.9, diamond: 1, dart: 1,
    square: 1, hexagon: 1, star: 1, star8: 1, lattice: 1, scurve: 1, vine: 1.05,
    // The ones with detail inside them, which need the room to show it.
    arrow: 1.15, spiral: 1.15, paisley: 1.2, flower: 1.35
};

/**
 * A shape pulled back inside its own band.
 *
 * The band is y ∈ [0, 1] and a motif that leaves it leaves its ring — on the
 * outermost ring, that means leaving the disc. It is an easy thing to do by
 * accident: the vine's leaves are hung off points along its stem, so the top
 * leaf reached a fifth of a band past the end of it, and the tree of a mistake
 * is not visible until the outer ring is the one that has it.
 *
 * Enforced here, once, rather than by being careful in twenty-five places. The
 * x axis is scaled by the same factor so nothing is squashed on the way in —
 * a motif that has to shrink to fit should come out smaller, not squatter.
 */
const fitToBand = (rings: UV[][]): UV[][] => {
    let lo = Infinity,
        hi = -Infinity;
    for (const a of rings) {
        for (const q of a) {
            if (q.y < lo) lo = q.y;
            if (q.y > hi) hi = q.y;
        }
    }
    if (!isFinite(lo) || (lo >= -1e-9 && hi <= 1 + 1e-9)) return rings;
    const k = Math.min(1, 1 / (hi - lo)),
        mid = (lo + hi) / 2,
        // Re-centred on the band as well as scaled, or a shape that only
        // overshot at the top would come back sitting low.
        shift = 0.5 - mid * k;
    return rings.map(a => a.map(q => ({ x: q.x * k, y: q.y * k + shift })));
};

/** A composed motif's rings, measured so the layout knows how it sits. */
const measure = (rawRings: UV[][], echo: boolean): Composed => {
    const rings = fitToBand(rawRings);
    let minY = Infinity,
        maxY = -Infinity,
        minX = Infinity,
        maxX = -Infinity;
    const aWide: UV[] = [];
    for (const a of rings) {
        for (const q of a) {
            if (q.y < minY) minY = q.y;
            if (q.y > maxY) maxY = q.y;
            if (q.x < minX) minX = q.x;
            if (q.x > maxX) maxX = q.x;
            // Only the outward-facing half matters, mirrored: a motif is
            // squeezed between the two neighbours it has, and both are the same
            // shape reflected.
            if (Math.abs(q.x) > 1e-4) aWide.push({ x: Math.abs(q.x), y: q.y });
        }
    }
    return {
        rings,
        aWide: aWide.length ? aWide : [{ x: 1e-4, y: 0.5 }],
        // The middle of the shape, which is what an echo has to shrink about.
        // Not the widest row: shrinking a star about its widest row slides the
        // small one up out of the big one.
        midX: isFinite(minX) ? (minX + maxX) / 2 : 0,
        midY: isFinite(minY) ? (minY + maxY) / 2 : 0.5,
        echo
    };
};

const COMPOSED: Record<ComposedMotif, Composed> = Object.fromEntries(
    (Object.keys(SHAPES) as ComposedMotif[]).map(k => [k, measure(SHAPES[k], ECHOES[k])])
) as Record<ComposedMotif, Composed>;

const isComposed = (m: Motif): m is ComposedMotif => m in COMPOSED;

/** Every motif there is, inside out through the picker's own order. */
export const MOTIFS: Motif[] = [
    "lotus", "petal", "drop", "scallop", "spoke", "diamond", "dart",
    "flower", "star", "star8", "square", "hexagon", "rings",
    "arrow", "paisley", "crescent", "chevron", "fret",
    "spiral", "scurve", "vine", "lattice", "hatch", "ray", "dots"
];

/** Is this string one of them? Layers arrive from a saved URL, so it is asked. */
export const isMotif = (s: string): s is Motif => (MOTIFS as string[]).includes(s);

/**
 * A ring of motif space put on the disc.
 *
 * `squash` narrows the shape across the slot when symmetry alone would make two
 * neighbours touch. Across only, never along: shrinking both would leave a gap
 * at the inner and outer edges of the band and the ring would stop reading as a
 * band at all.
 */
const placeUV = (
    aPt: UV[],
    centre: Point,
    r0: number,
    h: number,
    angle: number,
    squash: number
): Point[] =>
    aPt.map(q => {
        const r = r0 + h * q.y,
            a = angle + (q.x * squash * h) / Math.max(1e-6, r);
        return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
    });

/** A shape scaled about its own middle, for the echo. */
const shrinkUV = (aPt: UV[], k: number, cx: number, cy: number): UV[] =>
    aPt.map(q => ({ x: cx + (q.x - cx) * k, y: cy + (q.y - cy) * k }));

/** The motifs that are a shape in a band, as against a ring of circles. */
const BANDS: Motif[] = [
    ...(Object.keys(PROFILE) as BandMotif[]),
    ...(Object.keys(COMPOSED) as ComposedMotif[])
];

/**
 * A ring of small circles.
 *
 * Every mandala tutorial has one, and the reason is structural rather than
 * decorative: a run of bands all made of the same kind of shape reads as a set
 * of concentric fences. One ring of dots between them breaks the rhythm, and
 * suddenly the whole thing looks composed.
 */
const dotRing = (
    centre: Point,
    r0: number,
    r1: number,
    n: number,
    phase: number,
    fat = 1
): Point[][] => {
    const rMid = (r0 + r1) / 2,
        // Big enough to read, small enough that they never touch: half the band
        // or half the gap between two of them, whichever is less — and then
        // `fat`, which is the spacing control. Without it the dot ring would be
        // the one motif in the set that ignored the slider, and a negative
        // spacing that runs every other ring into a continuous band would leave
        // the dots sitting there in polite isolation.
        rDot = Math.min((r1 - r0) / 2, (Math.PI * rMid) / n * 0.62) * Math.max(0.1, fat);
    return Array.from({ length: n }, (_, k) => {
        const a = phase + (2 * Math.PI * k) / n;
        return circleRing(centre.x + rMid * Math.cos(a), centre.y + rMid * Math.sin(a), Math.max(0.2, rDot));
    });
};

/** Points per motif along each of its two edges. */
const STEPS = 26;

/** One motif, as a closed ring in Cartesian coordinates about the centre. */
const motifRing = (
    centre: Point,
    r0: number,
    r1: number,
    angle: number,
    halfMax: number,
    profile: (t: number) => number
): Point[] => {
    const at = (t: number, side: number): Point => {
        const r = r0 + (r1 - r0) * t,
            a = angle + side * halfMax * profile(t);
        return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
    };
    const out: Point[] = [];
    for (let i = 0; i <= STEPS; i++) out.push(at(i / STEPS, +1));
    for (let i = STEPS; i >= 0; i--) out.push(at(i / STEPS, -1));
    return out;
};

export const buildMandala = (opt: MandalaOptions): MandalaResult => {
    const L = MANDALA_LIMITS,
        warnings: string[] = [],
        size = clamp(opt.size, L.minSize, L.maxSize),
        R = size / 2,
        n = Math.round(clamp(opt.symmetry, L.minSymmetry, L.maxSymmetry)),
        rings = Math.round(clamp(opt.rings, L.minRings, L.maxRings)),
        // Negative is allowed, and it is the interesting half of the range.
        // Below zero a motif is wider than its own slot, so it laps over the
        // one beside it — see the merge below, which is what stops that being
        // two crossing cut lines.
        gap = clamp(opt.gap, -0.9, 0.8),
        bLap = gap < 0,
        ringGap = clamp(opt.ringGap, 0, R / 2),
        hub = clamp(opt.hub, 0, 0.8) * R,
        hole = clamp(opt.hole, 0, R),
        centre: Point = { x: R, y: R },
        next = rng(opt.seed);

    // ── which motif goes in which ring ──────────────────────────────────
    //
    // Decided before anything is measured, because the ring heights follow
    // from it: a band of dots wants a thread and a band of rosettes wants a
    // deep band, and which is which cannot be known until the motifs are.
    const aMotifKind: Motif[] = [];
    for (let i = 0; i < rings; i++) {
        const chosen = opt.layers?.[i];
        aMotifKind.push(
            chosen && isMotif(chosen)
                ? chosen
                // Mixed never puts two dot rings together and never opens on
                // one: a ring of dots is punctuation, and punctuation on its
                // own is not a sentence.
                : opt.style === "mixed"
                    ? (i > 0 && next() < 0.28 && aMotifKind[i - 1] !== "dots"
                        ? "dots"
                        : BANDS[Math.floor(next() * BANDS.length)]!)
                    : opt.style
        );
    }

    // The bands the rings occupy, inside out, each as tall as its own motif
    // asked for. Equal bands were what most made a generated mandala look
    // generated — see WEIGHT.
    const span = Math.max(0, R - hub - ringGap * rings),
        totalWeight = aMotifKind.reduce((s, m) => s + WEIGHT[m], 0) || 1,
        aRing: { r0: number; r1: number }[] = [];
    let atR = hub;
    for (const m of aMotifKind) {
        atR += ringGap;
        const h = (span * WEIGHT[m]) / totalWeight;
        aRing.push({ r0: atR, r1: atR + h });
        atR += h;
    }
    const band = rings ? span / rings : 0;

    /** A motif's own inner and outer radius: its band, less the air round it. */
    // `?? 1` rather than leaning on the clamp: `clamp` answers with its *lower*
    // bound for anything that is not a number, so an options object built
    // without this field would silently shrink every motif to a third of its
    // band rather than leaving it alone.
    const fill = clamp(opt.bandFill ?? 1, 0.3, 1),
        insetOf = (r: { r0: number; r1: number }) => {
            const pad = ((r.r1 - r.r0) * (1 - fill)) / 2;
            return { r0: r.r0 + pad, r1: r.r1 - pad };
        };

    // The widest a motif may be. Two limits, and the second one is what makes
    // this look like a mandala rather than a scatter of blobs: a motif is
    // allowed its whole slot less the web, *and* it is never wider than the
    // band it sits in is tall. Without that, twelve-fold symmetry on a shallow
    // ring gives shapes wider than they are long, and no amount of taste in the
    // profile can rescue those — they read as lumps at three sizes.
    // 0.42 is a *half*-width, so a motif is at most 0.84 of the band wide and
    // therefore always taller than it is wide. That is the proportion that
    // reads as a petal; anything squarer reads as a tile.
    const slotHalf = (Math.PI / n) * (1 - gap),
        aspect = 0.42;

    // Nesting is an engraved idea: a smaller hole inside a hole is a ring of
    // material that falls out on its own.
    const bNested = opt.nested && opt.mode !== "cut",
        aMotif: Point[][] = [],
        // The echoes are kept apart from the motifs they sit inside. Merging
        // them in would swallow them whole — an echo is entirely within its
        // parent, so a union of the two is the parent — and the echo is the
        // one thing that turns a shape into a motif.
        aEcho: Point[][] = [];
    let web = Infinity,
        nMotif = 0;

    /**
     * One ring's motifs, merged into as few outlines as they overlap into.
     *
     * Only when the spacing is negative, and that is not an optimisation. At
     * zero or above the motifs do not touch, so a merge would be a few hundred
     * polygons of work to return exactly what it was given — and it would round
     * every coordinate through the boolean library on a tool whose output has
     * been stable across releases.
     *
     * Below zero it is the whole point. Two outlines that cross are, to a
     * laser, four cuts and two loose pieces: the head runs round motif A,
     * through motif B, back out again, and the little lens where they crossed
     * drops out on its own. Merged, the pair is one closed contour and the
     * crossing never existed.
     */
    const mergeRing = (a: Point[][]): Point[][] =>
        bLap && a.length > 1 ? ringsOf(union(a.map(regionOf))) : a;

    for (const [i, band0] of aRing.entries()) {
        const motif = aMotifKind[i]!,
            // What the motif itself gets, which is its band less the air the
            // spacing control leaves at either edge.
            r = insetOf(band0);

        // Every other ring is turned half a slot, so the pattern reads as a
        // weave rather than as spokes lining up all the way out.
        const phase = (i % 2) * (Math.PI / n);

        if (motif === "dots") {
            // Dots grow with the spacing like everything else, so a negative
            // setting runs them into each other as a bead chain rather than
            // leaving the one ring in the set that ignores the slider.
            aMotif.push(...mergeRing(dotRing(centre, r.r0, r.r1, n, phase, 1 - gap)));
            nMotif += n;
            web = Math.min(web, ((2 * Math.PI * ((r.r0 + r.r1) / 2)) / n) * 0.24 * (1 - gap));
            continue;
        }

        if (isComposed(motif)) {
            // A composed motif keeps the proportions it was drawn with. It is
            // narrowed across the slot when symmetry demands it and otherwise
            // left alone — so one that was authored narrower than the full
            // width simply leaves more air round itself, rather than being
            // stretched to fill a slot it was never meant to fill.
            const shape = COMPOSED[motif],
                h = r.r1 - r.r0;

            // Both of these are worked out over every point of the shape rather
            // than over its widest one — see `aWide`.
            let squash = 1;
            for (const q of shape.aWide) {
                const rq = r.r0 + h * q.y;
                squash = Math.min(squash, (slotHalf * rq) / (q.x * h));
            }
            for (const q of shape.aWide) {
                const rq = r.r0 + h * q.y;
                web = Math.min(web, 2 * ((Math.PI / n) * rq - q.x * squash * h));
            }

            const aHere: Point[][] = [];
            for (let k = 0; k < n; k++) {
                const a = phase + (2 * Math.PI * k) / n;
                for (const ring of shape.rings) aHere.push(placeUV(ring, centre, r.r0, h, a, squash));
                if (bNested && shape.echo) {
                    for (const ring of shape.rings) {
                        aEcho.push(placeUV(shrinkUV(ring, 0.5, shape.midX, shape.midY), centre, r.r0, h, a, squash));
                    }
                }
            }
            aMotif.push(...mergeRing(aHere));
            nMotif += n;
            continue;
        }

        const profile = PROFILE[motif];

        // Where the motif is at its widest, and therefore where the material
        // between two of them is at its narrowest.
        let tFat = 0;
        for (let k = 0; k <= STEPS; k++) {
            if (profile(k / STEPS) > profile(tFat)) tFat = k / STEPS;
        }
        const rFat = r.r0 + (r.r1 - r.r0) * tFat,
            // The angle at which the motif would be exactly `aspect` of the
            // band wide, and the slot's own limit. Whichever is tighter wins.
            halfMax = Math.min(slotHalf, rFat > 0 ? (aspect * (r.r1 - r.r0)) / rFat : slotHalf),
            here = 2 * ((Math.PI / n) - halfMax * profile(tFat)) * rFat;
        web = Math.min(web, here);

        const aHere: Point[][] = [];
        for (let k = 0; k < n; k++) {
            const a = phase + (2 * Math.PI * k) / n;
            aHere.push(motifRing(centre, r.r0, r.r1, a, halfMax, profile));
            // The echo. Inset radially as well as narrowed, or it would touch
            // its parent at both ends.
            if (bNested) {
                const inset = (r.r1 - r.r0) * 0.22;
                aEcho.push(motifRing(centre, r.r0 + inset, r.r1 - inset, a, halfMax * 0.52, profile));
            }
        }
        aMotif.push(...mergeRing(aHere));
        nMotif += n;
    }

    if (!isFinite(web)) web = 0;

    // ── the middle and the edge ─────────────────────────────────────────
    //
    // A thin circle between the rings. Nothing structural — it is the single
    // cheapest thing that makes a set of repeated motifs read as one design
    // instead of three unrelated ones.
    const aRule: Point[][] = [];
    if (opt.ringLines && rings > 0) {
        for (const [i, r] of aRing.entries()) {
            if (i > 0) aRule.push(circleRing(centre.x, centre.y, r.r0 - ringGap / 2));
        }
        if (hub > 0) aRule.push(circleRing(centre.x, centre.y, hub + ringGap / 2));
    }

    const aHole: Point[][] = [];
    if (hole > 0) aHole.push(circleRing(centre.x, centre.y, hole / 2));

    const outline = opt.outline ? [circleRing(centre.x, centre.y, R)] : [];

    // ── sanity ──────────────────────────────────────────────────────────
    if (band <= 0) {
        warnings.push("The hub and the gaps between the rings take up the whole disc — there is no room left for a pattern.");
    }
    if (bLap) {
        warnings.push(
            "The motifs on each ring overlap and have been merged into one outline per ring, so there are no "
            + "crossing cut lines. What holds a cut one together is now the material between the rings — the "
            + "figure between motifs no longer applies, because there is none."
        );
    }
    if (opt.mode === "cut" && !bLap) {
        if (web < 1) {
            warnings.push(
                `Only ${mm(web)} of material is left between one motif and the next. Cut, this comes off the bed in `
                + "pieces. Raise the web, or drop the symmetry."
            );
        } else if (web < 2) {
            warnings.push(`${mm(web)} between motifs is fragile in anything but plywood. Handle the piece by its rim.`);
        }
    }
    if (opt.mode === "cut") {
        if (ringGap < 1 && rings > 1) {
            warnings.push(
                `The rings are ${mm(ringGap)} apart, which is what holds one ring to the next. Under a millimetre `
                + "they tear."
            );
        }
        if (hole > 0 && hole / 2 > hub) {
            warnings.push("The hanging hole is bigger than the hub it is punched in, so it eats into the first ring.");
        }
    }
    if (n > 40 && opt.mode === "cut") {
        warnings.push(`${n}-fold symmetry means ${n * rings} openings, most of them narrow. Beautiful engraved; brittle cut.`);
    }

    // ── layers ──────────────────────────────────────────────────────────
    // A rule is a *line* and never a hole: cut, it would fall out as a ring of
    // its own and take the pattern with it. So even on a cut mandala the rules
    // are engraved.
    const aLayer: MandalaLayer[] = opt.mode === "cut"
        ? [
            { operation: CUT, rings: [...outline, ...aMotif, ...aEcho, ...aHole], filled: false },
            ...(aRule.length ? [{ operation: MARK, rings: aRule, filled: false }] : [])
        ]
        : [
            ...(outline.length || aHole.length
                ? [{ operation: CUT, rings: [...outline, ...aHole], filled: false }]
                : []),
            opt.outlined
                ? { operation: MARK, rings: [...aMotif, ...aEcho, ...aRule], filled: false }
                : { operation: FILL, rings: [...aMotif, ...aEcho], filled: true },
            ...(!opt.outlined && aRule.length ? [{ operation: MARK, rings: aRule, filled: false }] : [])
        ];

    return {
        preview: svgOf(aLayer, size),
        aLayer,
        width: size,
        height: size,
        motifs: nMotif,
        web,
        // The material actually left between one ring of pattern and the next:
        // the gap between the bands plus the air the motifs leave at each of
        // their own edges. Reporting the gap alone would understate it by the
        // whole of the spacing control the moment that was turned down.
        ringWeb: ringGap + (rings > 1 ? band * (1 - fill) : 0),
        aMotifKind,
        points: aLayer.reduce((a, l) => a + l.rings.reduce((m, r) => m + r.length, 0), 0),
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const svgOf = (aLayer: MandalaLayer[], size: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(size)}mm" height="${r3(size)}mm"`
    + ` viewBox="0 0 ${r3(size)} ${r3(size)}">`
    + aLayer.map(l => {
        const d = l.rings.map(a => pathData(a)).join(" ");
        return l.filled
            ? `<path d="${d}" fill="${l.operation.css}" fill-rule="evenodd"/>`
            : `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="${EXPORT_STROKE}"/>`;
    }).join("")
    + "</svg>";

export const mandalaToSvg = (r: MandalaResult): string => svgOf(r.aLayer, r.width);

export const mandalaToDxf = (r: MandalaResult): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.rings.map(a => ({
            color: l.operation.color,
            closed: true,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const mandalaToFds = (r: MandalaResult): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: l.filled ? 0 : 2,
        subpaths: l.rings.map(a => ({ points: a, closed: true }))
    })));

/** Exported for the tests: the arc a circle of this radius needs. */
export const segmentsFor = (radius: number): number => arcSegments(radius, Math.PI / 2);
