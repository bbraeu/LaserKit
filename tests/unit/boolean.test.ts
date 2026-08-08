import { describe, expect, it } from "vitest";
import { exclude, intersect, regionOf, ringsOf, signedArea, subtract, union } from "../../src/lib/boolean";

const sq = (x: number, y: number, s: number) =>
    regionOf([{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]);

describe("vector booleans", () => {
    it("merges two overlapping squares into one outline", () => {
        const r = union([sq(0, 0, 10), sq(5, 5, 10)]);
        expect(r).toHaveLength(1);
        expect(r[0]!.rings).toHaveLength(1);
        expect(Math.abs(signedArea(r[0]!.rings[0]!))).toBeCloseTo(175, 3);
    });

    it("leaves two separate squares separate", () => {
        expect(union([sq(0, 0, 10), sq(50, 50, 10)])).toHaveLength(2);
    });

    it("keeps a hole as a hole", () => {
        const r = subtract([sq(0, 0, 30)], [sq(10, 10, 10)]);
        expect(r).toHaveLength(1);
        expect(r[0]!.rings).toHaveLength(2);
        expect(Math.abs(signedArea(r[0]!.rings[0]!))).toBeCloseTo(900, 3);
        expect(Math.abs(signedArea(r[0]!.rings[1]!))).toBeCloseTo(100, 3);
    });

    it("intersects to the overlap only", () => {
        const r = intersect([sq(0, 0, 10)], [sq(5, 5, 10)]);
        expect(Math.abs(signedArea(r[0]!.rings[0]!))).toBeCloseTo(25, 3);
    });

    it("excludes the overlap", () => {
        const r = exclude([sq(0, 0, 10)], [sq(5, 5, 10)]);
        expect(ringsOf(r).length).toBeGreaterThan(0);
        const area = ringsOf(r).reduce((s, a) => s + Math.abs(signedArea(a)), 0);
        expect(area).toBeCloseTo(150, 3);
    });

    it("survives one shape on its own", () => {
        const r = union([sq(0, 0, 10)]);
        expect(r).toHaveLength(1);
        expect(Math.abs(signedArea(r[0]!.rings[0]!))).toBeCloseTo(100, 3);
    });

    it("closes an open ring rather than leaving a notch", () => {
        const open = regionOf([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
        expect(Math.abs(signedArea(union([open])[0]!.rings[0]!))).toBeCloseTo(100, 3);
    });
});
