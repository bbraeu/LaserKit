import { union } from "./boolean";
import type { Region } from "./boolean";
import type { Point } from "./dxf";

// ---------------------------------------------------------------------------
// Strokes as polygons.
//
// A branch is a centreline with a width. Nothing can be cut from that: a laser
// needs a closed outline, and "the outline of a thick wandering line" is a
// polygon somebody has to work out.
//
// The kit's first answer was to paint the line onto a canvas and trace the
// result. That works and it costs exactness — a traced edge is a staircase at
// whatever resolution the canvas was, every curve comes back with a few hundred
// points, and the whole design has been through a raster round trip on its way
// to a vector file.
//
// This file does it properly instead. A stroke becomes: one quadrilateral per
// segment, plus one disc at every joint and at each end. Union them and the
// discs *are* the round joins and the round caps — no mitre limit to get wrong,
// no pinching where the line doubles back on itself, and it stays correct when
// a limb turns further in one segment than a normal-averaging offset could
// survive.
//
// It is more polygons than an offsetting algorithm would produce and they are
// all thrown away by the union immediately. That is the trade: a few hundred
// throwaway quads against having to be right about mitres, self-intersection
// and cusps in a file nobody will look at again for a year.
// ---------------------------------------------------------------------------

/** Points round a circle, for a joint or a cap. */
const disc = (cx: number, cy: number, r: number, segs = 20, phase = 0): Point[] =>
    Array.from({ length: segs }, (_, i) => {
        const a = (2 * Math.PI * i) / segs + phase;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

/**
 * The parts of one stroked polyline, ready to be unioned.
 *
 * `widthAt` is given the distance along as a fraction, so a limb can taper —
 * which is what a branch does, and what a constant-width stroke cannot look
 * like. Returned unmerged so a caller with fifty limbs can union all of them in
 * one sweep instead of fifty.
 */
export const strokeParts = (points: Point[], widthAt: (t: number) => number): Region[] => {
    const n = points.length;
    if (n === 0) return [];

    const half = (i: number): number => Math.max(1e-4, widthAt(n === 1 ? 0 : i / (n - 1)) / 2);

    if (n === 1) return [{ rings: [disc(points[0]!.x, points[0]!.y, half(0))] }];

    const out: Region[] = [];
    for (let i = 0; i < n - 1; i++) {
        const p = points[i]!,
            q = points[i + 1]!,
            dx = q.x - p.x,
            dy = q.y - p.y,
            len = Math.hypot(dx, dy);
        // A zero-length segment has no direction to offset along, and its joint
        // disc covers whatever it would have contributed anyway.
        if (len < 1e-9) continue;
        const nx = -dy / len,
            ny = dx / len,
            a = half(i),
            b = half(i + 1);
        out.push({
            rings: [[
                { x: p.x + nx * a, y: p.y + ny * a },
                { x: q.x + nx * b, y: q.y + ny * b },
                { x: q.x - nx * b, y: q.y - ny * b },
                { x: p.x - nx * a, y: p.y - ny * a }
            ]]
        });
    }

    // The joints and the two ends. Every disc is turned a little from the last,
    // so two touching circles never present the sweep line with a pair of
    // identical vertices — see `nudge` in boolean.ts for why that matters.
    for (let i = 0; i < n; i++) {
        const p = points[i]!,
            r = half(i);
        if (r > 1e-4) out.push({ rings: [disc(p.x, p.y, r, 20, (i % 5) * 0.031)] });
    }
    return out;
};

/** One stroked polyline as a merged outline. */
export const strokeRegion = (points: Point[], widthAt: (t: number) => number): Region[] =>
    union(strokeParts(points, widthAt));

/** A stroke of constant width, which is most of them. */
export const strokeOf = (points: Point[], width: number): Region[] =>
    strokeRegion(points, () => width);
