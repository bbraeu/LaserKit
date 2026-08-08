import { describe, expect, it } from "vitest";
import { signedArea } from "../../src/lib/boolean";
import { strokeOf, strokeParts, strokeRegion } from "../../src/lib/stroke";

// A branch is a centreline with a width, and a laser needs a closed outline.
// What is pinned here is that turning one into the other keeps the area it
// should and does not pinch where the line turns hard — which is the failure a
// normal-averaging offset has, and the reason this is built out of quads and
// discs instead.

const line = (n: number, len: number) =>
    Array.from({ length: n }, (_, i) => ({ x: (len * i) / (n - 1), y: 0 }));

describe("strokes as polygons", () => {
    it("gives a straight stroke the area of a rectangle with round ends", () => {
        const r = strokeOf(line(2, 100), 10),
            area = r.reduce((s, o) => s + Math.abs(signedArea(o.rings[0]!)), 0);
        // 100 × 10 for the body plus a 5 mm radius disc for the two caps, less
        // a little for the disc being a twenty-gon.
        expect(area).toBeGreaterThan(100 * 10 + 60);
        expect(area).toBeLessThan(100 * 10 + Math.PI * 25 + 1);
    });

    it("comes back as one outline, not one per segment", () => {
        // Fifty quads and fifty-one discs go in; one closed cut comes out.
        expect(strokeOf(line(50, 100), 6)).toHaveLength(1);
        expect(strokeParts(line(50, 100), () => 6).length).toBeGreaterThan(90);
    });

    it("does not pinch where the line doubles back on itself", () => {
        // The case that breaks offsetting by averaged vertex normals: the two
        // sides cross over and the outline ties itself in a knot, losing area.
        const hairpin = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 3 }],
            r = strokeRegion(hairpin, () => 8);
        expect(r.length).toBeGreaterThanOrEqual(1);
        const area = r.reduce((s, o) => s + Math.abs(signedArea(o.rings[0]!)), 0);
        // Two 40 mm runs 8 mm wide, overlapping heavily — but nowhere near zero,
        // which is what a pinched offset gives.
        expect(area).toBeGreaterThan(300);
    });

    it("tapers", () => {
        const fat = strokeRegion(line(20, 100), () => 10),
            thin = strokeRegion(line(20, 100), t => 10 * (1 - 0.8 * t)),
            areaOf = (r: typeof fat) => r.reduce((s, o) => s + Math.abs(signedArea(o.rings[0]!)), 0);
        expect(areaOf(thin)).toBeLessThan(areaOf(fat));
        expect(areaOf(thin)).toBeGreaterThan(areaOf(fat) * 0.3);
    });

    it("copes with a repeated point rather than dividing by zero", () => {
        const doubled = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
        const r = strokeRegion(doubled, () => 4);
        expect(r).toHaveLength(1);
        expect(Math.abs(signedArea(r[0]!.rings[0]!))).toBeGreaterThan(20 * 4 * 0.9);
    });

    it("has nothing to say about an empty line", () => {
        expect(strokeRegion([], () => 5)).toHaveLength(0);
    });
});
