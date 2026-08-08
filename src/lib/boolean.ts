import polygonClipping from "polygon-clipping";
import type { Point } from "./dxf";

// ---------------------------------------------------------------------------
// Vector booleans.
//
// Until now this kit had one answer to "these two shapes overlap": paint them
// onto a canvas and trace the result once. That is the right answer for the
// curved text and for the tree of life, because what those merge is
// *centrelines with widths* — a stroked path, which has no polygon to union
// until something has decided where its edges are.
//
// It is the wrong answer here. An interlocking mandala is closed shapes
// overlapping closed shapes, both of which are already polygons, and a raster
// round trip costs the one thing this file exists to keep: exactness. Trace a
// union at eight pixels per millimetre and every straight edge comes back as a
// staircase, every circle as a hundred-and-something-gon, and the file grows by
// an order of magnitude — on a design whose whole point is that it be cut
// cleanly.
//
// So: real booleans, on real polygons, with holes. The library does the sweep;
// this file is the translation layer between its arrays-of-arrays and the
// `Point[]` rings the rest of the kit passes around, plus the two conventions
// that matter — closed rings and winding — stated once instead of at every call
// site.
// ---------------------------------------------------------------------------

/** A closed ring, first point repeated at the end, as the library wants it. */
type Ring = [number, number][];
type Poly = Ring[];

/**
 * One shape as the boolean library sees it: an outer ring and its holes.
 *
 * `rings[0]` is the outside and everything after it is a hole in that outside.
 * This is the shape that comes back out too, which is why it is worth a name.
 */
export interface Region {
    rings: Point[][];
}

/**
 * A ring closed and de-duplicated.
 *
 * The kit's rings are implicitly closed — the drawing code joins the last point
 * back to the first — while the boolean library wants that join written down.
 * Getting it wrong does not throw; it produces a subtly open polygon whose
 * union has a notch in it, which is exactly the kind of thing that is invisible
 * until it is on the bed.
 */
const closed = (a: Point[]): Ring => {
    const out: Ring = [];
    for (const p of a) {
        const last = out[out.length - 1];
        // Consecutive duplicates make zero-length edges, and a sweep-line
        // algorithm given a zero-length edge is entitled to anything.
        if (!last || Math.abs(last[0] - p.x) > 1e-9 || Math.abs(last[1] - p.y) > 1e-9) out.push([p.x, p.y]);
    }
    const first = out[0],
        last = out[out.length - 1];
    if (first && last && (Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9)) {
        out.push([first[0], first[1]]);
    }
    return out;
};

const toPoly = (r: Region): Poly => r.rings.map(closed).filter(a => a.length >= 4);

const fromMulti = (m: number[][][][]): Region[] =>
    m.map(poly => ({
        rings: poly.map(ring =>
            // The closing point goes back off again: everything downstream in
            // this kit treats a ring as implicitly closed, and leaving it on
            // would draw one duplicate line segment per shape in the DXF.
            ring.slice(0, -1).map(([x, y]) => ({ x: x!, y: y! }))
        ).filter(a => a.length >= 3)
    })).filter(o => o.rings.length > 0);

/** Anything with an area at all: the guard every operation below shares. */
const usable = (a: Region[]): Poly[] => a.map(toPoly).filter(p => p.length > 0);

/**
 * Every coordinate nudged by a deterministic, invisible amount.
 *
 * A sweep-line boolean is exact arithmetic on inexact inputs, and it gives up
 * when two edges cross at a point it cannot place consistently — which happens
 * most readily on the geometry anybody actually draws: two circles the same
 * size, sampled at the same angles, a radius apart. Perfectly symmetric input
 * is the worst case, not the easy one.
 *
 * A nanometre of asymmetry fixes it. The nudge is derived from the point's
 * index rather than from a random number so the same drawing always comes out
 * the same way — a mandala that quietly changed between two exports of the same
 * parameters would be worse than one that failed.
 */
const nudge = (p: Poly[], d: number): Poly[] =>
    p.map(poly => poly.map(ring => ring.map(([x, y], i): [number, number] =>
        [x + d * ((i % 3) - 1), y + d * ((i % 5) - 2)])));

/**
 * Run a boolean, retrying with progressively more asymmetry.
 *
 * Ladder rather than a single retry: a nanometre clears the common case and a
 * hundredth of a micron clears the rest, and both are orders of magnitude below
 * anything a laser can act on — the beam is a tenth of a *millimetre*. The
 * fallback is the caller's, and is always "the drawing as it was" rather than
 * nothing: on a canvas somebody is dragging a slider on, an un-merged drawing
 * is a far better answer than an empty one.
 */
const attempt = <T>(run: (extra: number) => T, fallback: () => T): T => {
    for (const d of [0, 1e-9, 1e-7, 1e-5]) {
        try {
            return run(d);
        } catch {
            /* try again with a little more asymmetry */
        }
    }
    return fallback();
};

/**
 * Everything merged into as few regions as it takes.
 *
 * This is the operation the interlocking engine is built on. Forty shapes that
 * overlap their neighbours come back as one region with a scalloped outline and
 * however many holes the gaps between them left — which is the drawing, and is
 * also exactly one closed cut per contour.
 *
 * Anything that fails to merge is returned as it went in rather than dropped.
 * A boolean library that meets geometry it cannot resolve throws, and the right
 * answer on a canvas somebody is dragging a slider on is the un-merged drawing,
 * not an empty one.
 */
export const union = (a: Region[]): Region[] => {
    const polys = usable(a);
    if (polys.length === 0) return [];
    return attempt(
        d => {
            const p = d === 0 ? polys : nudge(polys, d);
            return fromMulti(polygonClipping.union(p[0]!, ...p.slice(1)) as unknown as number[][][][]);
        },
        () => a
    );
};

/** What `a` keeps once everything in `b` is taken out of it. */
export const subtract = (a: Region[], b: Region[]): Region[] => {
    const left = usable(a),
        right = usable(b);
    if (left.length === 0) return [];
    if (right.length === 0) return a;
    return attempt(
        d => fromMulti(polygonClipping.difference(
            left as unknown as never,
            ...((d === 0 ? right : nudge(right, d)) as unknown as never[])
        )),
        () => a
    );
};

/** Only where they all overlap — the vesica piscis of two circles. */
export const intersect = (a: Region[], b: Region[]): Region[] => {
    const left = usable(a),
        right = usable(b);
    if (left.length === 0 || right.length === 0) return [];
    return attempt(
        d => fromMulti(polygonClipping.intersection(
            left as unknown as never,
            ...((d === 0 ? right : nudge(right, d)) as unknown as never[])
        )),
        () => []
    );
};

/** Everywhere exactly one of them covers: overlaps punch through. */
export const exclude = (a: Region[], b: Region[]): Region[] => {
    const left = usable(a),
        right = usable(b);
    if (left.length === 0) return b;
    if (right.length === 0) return a;
    return attempt(
        d => fromMulti(polygonClipping.xor(
            left as unknown as never,
            ...((d === 0 ? right : nudge(right, d)) as unknown as never[])
        )),
        () => [...a, ...b]
    );
};

/** Every ring of every region, flat — what the exporters take. */
export const ringsOf = (a: Region[]): Point[][] => a.flatMap(o => o.rings);

/** A single closed outline as a region with no holes. */
export const regionOf = (a: Point[]): Region => ({ rings: [a] });

/**
 * The signed area of a ring: positive anticlockwise in maths axes, and since
 * the whole kit works in screen axes with y downwards, positive means
 * clockwise on screen. Used to tell an outline from the hole inside it.
 */
export const signedArea = (a: Point[]): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        const p = a[i]!,
            q = a[(i + 1) % a.length]!;
        s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
};
