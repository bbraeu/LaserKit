import { describe, expect, it } from "vitest";
import { SHAPES, placeShape, shapeById } from "../../src/lib/shapes";
import { signedArea } from "../../src/lib/boolean";

// The library is the foundation the interlocking engine stands on, and what has
// to hold is not what any one shape looks like but that they are
// interchangeable: swap one for another on a ring and the drawing changes, the
// layout does not.

describe("the shape library", () => {
    it("gives every shape the same long axis", () => {
        // The size slider is a length in millimetres. That only means the same
        // thing for a circle as for a spiral if the unit shapes agree.
        for (const o of SHAPES) {
            const xs = o.region.rings.flatMap(a => a.map(p => p.x));
            expect(Math.min(...xs), o.id).toBeCloseTo(-1, 6);
            expect(Math.max(...xs), o.id).toBeCloseTo(1, 6);
        }
    });

    it("centres every shape on the origin", () => {
        for (const o of SHAPES) {
            const ys = o.region.rings.flatMap(a => a.map(p => p.y));
            expect((Math.min(...ys) + Math.max(...ys)) / 2, o.id).toBeCloseTo(0, 6);
        }
    });

    it("measures how wide each one is rather than being told", () => {
        // A spike is narrow and a circle is round; squashing them to one width
        // would make the library one shape with nineteen labels.
        for (const o of SHAPES) expect(o.aspect, o.id).toBeGreaterThan(0.05);
        expect(shapeById("circle").aspect).toBeCloseTo(1, 6);
        expect(shapeById("spike").aspect).toBeLessThan(shapeById("circle").aspect);
    });

    it("gives every shape some area", () => {
        for (const o of SHAPES) {
            const outer = Math.abs(signedArea(o.region.rings[0]!));
            expect(outer, o.id).toBeGreaterThan(0.1);
        }
    });

    it("makes the concentric ring a real hole rather than a second outline", () => {
        // Two outlines stacked would be two cuts, and the middle would drop out
        // as a disc. A hole is a hole.
        const ring = shapeById("annulus");
        expect(ring.region.rings).toHaveLength(2);
        expect(Math.abs(signedArea(ring.region.rings[1]!)))
            .toBeLessThan(Math.abs(signedArea(ring.region.rings[0]!)));
    });

    it("builds the crescent and the vesica out of circles, so they are exact", () => {
        // A crescent is a disc less an offset disc; a vesica is the overlap of
        // two. Plotted by formula they would be approximations of themselves.
        expect(shapeById("crescent").region.rings).toHaveLength(1);
        expect(shapeById("vesica").region.rings).toHaveLength(1);
        // The vesica comes to a point at each end, so it is much thinner than
        // the discs that made it.
        expect(shapeById("vesica").aspect).toBeLessThan(0.75);
    });

    it("puts a placed shape where it was told to", () => {
        const c = { x: 100, y: 100 },
            r = placeShape(shapeById("circle"), c, 40, 0, 10, 10, 0),
            xs = r.rings[0]!.map(p => p.x),
            ys = r.rings[0]!.map(p => p.y);
        // Centred 40 mm out along +x, and 10 mm across.
        expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(140, 6);
        expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(100, 6);
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 3);
    });

    it("sets length and width apart, which is what makes size and spacing two controls", () => {
        // With the count and the radius fixed, the centres are where they are —
        // so the only thing that can change the gap between two neighbours is
        // how wide they are. Scale uniformly and the size slider is secretly a
        // spacing slider as well.
        const wide = placeShape(shapeById("circle"), { x: 0, y: 0 }, 0, 0, 10, 30, 0),
            xs = wide.rings[0]!.map(p => p.x),
            ys = wide.rings[0]!.map(p => p.y);
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 3);
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30, 3);
    });

    it("turns a shape about its own middle, not about the mandala's", () => {
        const c = { x: 0, y: 0 },
            spun = placeShape(shapeById("spike"), c, 50, 0, 20, 6, Math.PI / 2),
            xs = spun.rings[0]!.map(p => p.x);
        // A quarter turn puts the long axis across the ring, so its own x
        // extent collapses to its width.
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(20 * 0.9);
        expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(50, 1);
    });
});
