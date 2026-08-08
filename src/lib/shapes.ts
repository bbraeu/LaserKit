import { intersect, regionOf, subtract, union } from "./boolean";
import type { Region } from "./boolean";
import type { Point } from "./dxf";

// ---------------------------------------------------------------------------
// The shape library.
//
// Every stamp the interlocking engine can place, drawn once in a space of its
// own and normalised so they are interchangeable. Two conventions, and both
// exist so that swapping one shape for another on a ring changes the drawing
// and nothing else:
//
//   • **+x is outwards.** A shape is authored pointing away from the middle of
//     the mandala, so a petal is a lens lying along x. The engine rotates it
//     into place; nothing here knows about rings.
//   • **The long axis is exactly 2.** Every shape is scaled after it is built
//     so its x-extent runs −1…1. The size slider is then a length in
//     millimetres and means the same thing for a circle as for a spiral.
//
// The width across is *not* normalised, deliberately. A spike is narrow and a
// circle is round, and squashing them to the same width would make the library
// one shape with nineteen labels. What the width is gets measured rather than
// declared — see `aspect` — because the spacing control needs to know how wide
// a shape really is, and a number typed in by hand next to a shape drawn by
// formula goes stale the first time the formula is touched.
//
// Four of them are built with the boolean operations rather than plotted: an
// annulus is a disc with a disc taken out of it, a crescent is a disc with an
// offset disc taken out of it, and a vesica is the overlap of two. Those are
// their definitions, so that is how they are written — and it means the ring of
// a concentric ring is exactly concentric rather than nearly.
// ---------------------------------------------------------------------------

export type ShapeCategory = "geometric" | "organic" | "accent";

export type ShapeId =
    | "circle" | "annulus" | "triangle" | "square" | "hexagon" | "octagon" | "diamond"
    | "petalLotus" | "petalRound" | "petalLance" | "teardrop" | "spiral" | "scurve"
    | "star5" | "star6" | "star8" | "vesica" | "crescent" | "spike";

export interface ShapeDef {
    id: ShapeId;
    label: string;
    category: ShapeCategory;
    hint: string;
    /** the outline, and any holes in it, in unit space */
    region: Region;
    /**
     * Half the shape's extent across the ring, in unit space.
     *
     * What the spacing control measures against: two neighbours touch when the
     * angle between them equals twice this, scaled and divided by the radius.
     */
    aspect: number;
}

const TAU = Math.PI * 2;

/**
 * A circle as a polygon, fine enough that no cut shows the facets.
 *
 * `phase` turns where the first vertex sits. It exists for one reason: two
 * circles sampled at the same angles put vertices in exactly the same places,
 * and that is the input a sweep-line boolean is least able to resolve. Half a
 * step of offset costs nothing and avoids the whole question.
 */
const disc = (cx: number, cy: number, r: number, segs = 96, phase = 0): Point[] =>
    Array.from({ length: segs }, (_, i) => {
        const a = (TAU * i) / segs + phase;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

/** A regular polygon with a vertex pointing outwards, which is along +x. */
const regular = (sides: number, r = 1): Point[] =>
    Array.from({ length: sides }, (_, i) => {
        const a = (TAU * i) / sides;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });

/** A star with two radii, a point on +x. */
const star = (points: number, rOut = 1, rIn = 0.45): Point[] =>
    Array.from({ length: points * 2 }, (_, k) => {
        const a = (Math.PI * k) / points,
            r = k % 2 === 0 ? rOut : rIn;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });

/**
 * A shape given as a half-profile: how far it stands off the x axis at each
 * point along it, mirrored.
 *
 * Every petal in the library is one of these and nothing else, which is the
 * point — a lotus petal and a lance leaf differ by an exponent, and writing
 * them as two hand-plotted outlines would let them drift apart.
 */
const profile = (half: (t: number) => number, segs = 72): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i <= segs; i++) out.push({ x: -1 + 2 * (i / segs), y: half(i / segs) });
    for (let i = segs; i >= 0; i--) out.push({ x: -1 + 2 * (i / segs), y: -half(i / segs) });
    return out;
};

/**
 * A centreline given a width: a stroke turned into the outline of a stroke.
 *
 * The spiral and the S-curve are lines, and a line has no area to cut. Offsetting
 * by averaged vertex normals is only correct while the line does not turn
 * sharply over one segment, which is why both of them are sampled finely.
 */
const ribbon = (spine: Point[], width: (t: number) => number): Point[] => {
    const n = spine.length,
        normalAt = (i: number): Point => {
            const a = spine[Math.max(0, i - 1)]!,
                b = spine[Math.min(n - 1, i + 1)]!,
                dx = b.x - a.x,
                dy = b.y - a.y,
                len = Math.hypot(dx, dy) || 1;
            return { x: -dy / len, y: dx / len };
        },
        left: Point[] = [],
        right: Point[] = [];
    for (let i = 0; i < n; i++) {
        const p = spine[i]!,
            hw = Math.max(1e-4, width(i / (n - 1))) / 2,
            v = normalAt(i);
        left.push({ x: p.x + v.x * hw, y: p.y + v.y * hw });
        right.push({ x: p.x - v.x * hw, y: p.y - v.y * hw });
    }
    return [...left, ...right.reverse()];
};

const bounds = (rings: Point[][]) => {
    let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
    for (const a of rings) {
        for (const p of a) {
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.y > y1) y1 = p.y;
        }
    }
    return { x0, x1, y0, y1 };
};

/**
 * A shape centred on the origin with its long axis running exactly −1…1.
 *
 * Applied to every shape without exception, including the ones built by
 * boolean operations, whose extent depends on radii chosen to make the shape
 * look right rather than to make it measure 2.
 */
const normalise = (region: Region): { region: Region; aspect: number } => {
    const b = bounds(region.rings),
        cx = (b.x0 + b.x1) / 2,
        cy = (b.y0 + b.y1) / 2,
        k = 2 / Math.max(1e-6, b.x1 - b.x0),
        rings = region.rings.map(a => a.map(p => ({ x: (p.x - cx) * k, y: (p.y - cy) * k })));
    return { region: { rings }, aspect: ((b.y1 - b.y0) / 2) * k };
};

// ── the ones that are defined by a boolean ──────────────────────────────
//
// Written as what they are rather than plotted as what they look like.

const ANNULUS = subtract(
    [regionOf(disc(0, 0, 1))],
    [regionOf(disc(0, 0, 0.58, 96, Math.PI / 96))]
);

const CRESCENT = subtract(
    [regionOf(disc(0, 0, 1))],
    [regionOf(disc(0.42, 0, 0.86, 96, Math.PI / 96))]
);

// Two discs a radius apart: their overlap is the vesica piscis, and stacking
// them along y rather than x leaves the lens lying along the radius, which is
// how a petal wants to sit.
// The half-step phase offset is not decoration. Two discs sampled at the same
// angles put four vertices in exactly the same places, and that is the case the
// sweep line gives up on — see `nudge` in boolean.ts. Offsetting one of them by
// half a step is the cheaper fix here, because it is free and it is local.
const VESICA = intersect(
    [regionOf(disc(0, 0.5, 1))],
    [regionOf(disc(0, -0.5, 1, 96, Math.PI / 96))]
);

/**
 * The one region a boolean-built shape is meant to be, or a loud failure.
 *
 * This started life as `a[0] ?? regionOf(disc(0, 0, 1))` and that was the worst
 * kind of wrong. The vesica came back empty — the boolean library will not
 * resolve two identically-sampled circles a radius apart, which is the most
 * symmetric input there is and therefore the one it likes least — and the
 * fallback quietly handed back a *circle*. A circle is a perfectly reasonable
 * shape, so nothing looked broken; the picker just had two circles in it, one
 * of them labelled "vesica piscis".
 *
 * The library is static, so if one of these is empty it is empty for everybody
 * on every machine, and the right time to find out is the first time anything
 * imports this file.
 */
const first = (a: Region[], what: string): Region => {
    const r = a[0];
    if (!r || r.rings.length === 0) throw new Error(`The shape library could not build the ${what}.`);
    return r;
};

const SPEC: { id: ShapeId; label: string; category: ShapeCategory; hint: string; region: Region }[] = [
    // ── A. geometric ────────────────────────────────────────────────────
    {
        id: "circle", label: "Circle", category: "geometric",
        hint: "The one shape that reads the same at every rotation, so a ring of them is the calmest thing you can put next to a busy one.",
        region: regionOf(disc(0, 0, 1))
    },
    {
        id: "annulus", label: "Concentric ring", category: "geometric",
        hint: "A disc with a disc taken out of it — a real hole, not a second outline on top. Overlapped with its neighbours the holes stay holes, which is what makes a chain.",
        region: first(ANNULUS, "concentric ring")
    },
    {
        id: "triangle", label: "Triangle", category: "geometric",
        hint: "Point outwards. Three straight edges overlap into sharp lens-shaped voids, which is the most angular interlock the library makes.",
        region: regionOf(regular(3))
    },
    {
        id: "square", label: "Square", category: "geometric",
        hint: "On its corner, so it meets its neighbours edge to edge as they close up.",
        region: regionOf(regular(4))
    },
    {
        id: "hexagon", label: "Hexagon", category: "geometric",
        hint: "Six sides tile without gaps at the right spacing, which no other shape here does.",
        region: regionOf(regular(6))
    },
    {
        id: "octagon", label: "Octagon", category: "geometric",
        hint: "Nearly a circle with corners to catch the light. Reads as architecture rather than as a flower.",
        region: regionOf(regular(8))
    },
    {
        id: "diamond", label: "Diamond", category: "geometric",
        hint: "A rhombus twice as long as it is wide — the classic filler between two heavier rings.",
        region: regionOf([{ x: 1, y: 0 }, { x: 0, y: 0.5 }, { x: -1, y: 0 }, { x: 0, y: -0.5 }])
    },

    // ── B. floral and organic ───────────────────────────────────────────
    {
        id: "petalLotus", label: "Lotus petal", category: "organic",
        hint: "Drawn out to a sharp point at both ends. The shape most people picture when they hear “mandala”.",
        region: regionOf(profile(t => Math.sin(Math.PI * t) ** 1.7 * 0.62))
    },
    {
        id: "petalRound", label: "Rounded petal", category: "organic",
        hint: "Narrow at the middle end and round at the outer, like a flame. A ring of them reads as motion.",
        region: regionOf(profile(t => Math.sin(Math.PI * t) ** 0.55 * (0.28 + 0.55 * t) * 0.86))
    },
    {
        id: "petalLance", label: "Lance petal", category: "organic",
        hint: "Widest a third of the way along and tapering to a long point — a leaf rather than a petal.",
        region: regionOf(profile(t => Math.sin(Math.PI * t ** 0.62) ** 1.15 * 0.5))
    },
    {
        id: "teardrop", label: "Teardrop", category: "organic",
        hint: "Round at one end and pointed at the other. Overlapped it makes the comma-shaped voids that a paisley is built from.",
        region: regionOf(profile(t => Math.sin(Math.PI * (t * 0.5 + 0.5)) ** 0.75 * (1 - t) ** 0.55 * 0.78))
    },
    {
        id: "spiral", label: "Spiral", category: "organic",
        hint: "Two and a half turns, drawn as a band of even thickness. Busy: give it room, or overlap it heavily and let the union do the work.",
        region: regionOf(ribbon(
            Array.from({ length: 140 }, (_, i) => {
                const t = i / 139,
                    th = TAU * 2.5 * t,
                    r = 0.06 + 0.94 * t;
                return { x: r * Math.cos(th), y: r * Math.sin(th) };
            }),
            () => 0.17
        ))
    },
    {
        id: "scurve", label: "S-curve", category: "organic",
        hint: "Two bends the same size in opposite directions. Laid round a ring and overlapped, this is what a woven border is made of.",
        region: regionOf(ribbon(
            Array.from({ length: 90 }, (_, i) => {
                const t = i / 89;
                return { x: -1 + 2 * t, y: 0.42 * Math.sin(TAU * t) };
            }),
            t => 0.20 * Math.sin(Math.PI * t) ** 0.3 + 0.03
        ))
    },

    // ── C. accents and symbols ──────────────────────────────────────────
    {
        id: "star5", label: "Star (5)", category: "accent",
        hint: "Two radii instead of one. The deep notches mean it interlocks with its own neighbours rather than merely touching them.",
        region: regionOf(star(5, 1, 0.42))
    },
    {
        id: "star6", label: "Star (6)", category: "accent",
        hint: "Six points, which lines up with a hexagon ring above or below it.",
        region: regionOf(star(6, 1, 0.5))
    },
    {
        id: "star8", label: "Star (8)", category: "accent",
        hint: "Shallower notches, so it survives being repeated forty times where the five-pointed one turns to mush.",
        region: regionOf(star(8, 1, 0.62))
    },
    {
        id: "vesica", label: "Vesica piscis", category: "accent",
        hint: "The overlap of two circles a radius apart, taken as a real intersection. The oldest interlocking figure there is.",
        region: first(VESICA, "vesica piscis")
    },
    {
        id: "crescent", label: "Crescent", category: "accent",
        hint: "A disc with an offset disc taken out of it. Nest a ring of them into each other and the horns thread through the gaps.",
        region: first(CRESCENT, "crescent")
    },
    {
        id: "spike", label: "Spike", category: "accent",
        hint: "A long triangle standing on its base. Overlapped, the bases merge into a rim and only the points stay separate — a sunburst in one slider.",
        region: regionOf([{ x: 1, y: 0 }, { x: -1, y: 0.34 }, { x: -1, y: -0.34 }])
    }
];

/** Every shape, normalised, in the order the picker shows them. */
export const SHAPES: ShapeDef[] = SPEC.map(o => {
    const { region, aspect } = normalise(o.region);
    return { ...o, region, aspect };
});

const BY_ID = new Map(SHAPES.map(o => [o.id, o]));

export const shapeById = (id: ShapeId): ShapeDef => BY_ID.get(id) ?? SHAPES[0]!;

export const isShapeId = (s: string): s is ShapeId => BY_ID.has(s as ShapeId);

export const CATEGORY_LABEL: Record<ShapeCategory, string> = {
    geometric: "Geometric",
    organic: "Floral & organic",
    accent: "Accents & symbols"
};

/**
 * One shape placed: scaled, turned, and moved out to a radius.
 *
 * Length and width are set **separately**, and that is not a convenience — it
 * is what makes "size" and "spacing" two controls instead of one. On a ring
 * with a fixed count at a fixed radius the centres are where they are, so the
 * only thing that can change the gap between two neighbours is how wide they
 * are. Scale a shape uniformly and every size slider is also a spacing slider
 * and vice versa; scale it along the radius and across the radius
 * independently and you get what anybody composing a mandala actually wants —
 * how far this ring reaches, and how much it laps the shape beside it.
 *
 * `length` is the reach outwards, `width` the extent across. Both in
 * millimetres, both the full extent rather than a half, because those are the
 * numbers a person measures on the finished piece.
 */
export const placeShape = (
    def: ShapeDef,
    centre: Point,
    radius: number,
    angle: number,
    length: number,
    width: number,
    spin: number
): Region => {
    // The unit shape is exactly 2 long, so half the asked-for length is the
    // factor; its half-width is whatever `aspect` measured, so the width factor
    // has to divide that out.
    const kx = length / 2,
        ky = width / (2 * Math.max(1e-6, def.aspect)),
        a = angle + spin,
        c = Math.cos(a),
        s = Math.sin(a),
        cx = centre.x + radius * Math.cos(angle),
        cy = centre.y + radius * Math.sin(angle);
    return {
        rings: def.region.rings.map(ring => ring.map(p => {
            const x = p.x * kx,
                y = p.y * ky;
            return { x: cx + x * c - y * s, y: cy + x * s + y * c };
        }))
    };
};

/** Kept so a caller can merge a whole ring without importing the boolean layer. */
export const mergeShapes = union;
