import { describe, expect, it } from "vitest";
import {
    arcSegments, circleRing, dedupe, ellipseRing, inRing, rectRing, ringArea,
    simplifyRing, subBounds
} from "../../src/lib/design";
import { FLATTEN_TOLERANCE } from "../../src/lib/dxf";
import { buildStampKit } from "../../src/lib/stamp";
import type { HandleType } from "../../src/lib/stamp";
import { convertSetting, detectLaser, getLaser } from "../../src/lib/lasers";

// The geometry the UI reports numbers from. None of it changed in the redesign,
// which is exactly why it is worth pinning: the status bar now shows these
// figures permanently instead of in a panel below the fold, so a regression
// here is visible on every screen rather than after a scroll.

describe("rings", () => {
    it("measures a rectangle's area exactly", () => {
        expect(ringArea(rectRing({ x0: 0, y0: 0, x1: 10, y1: 4 }, 0))).toBeCloseTo(40, 9);
    });

    it("clamps a corner radius to half the shorter side", () => {
        // A 10 × 4 box asked for r = 50 becomes a stadium, r = 2 — not a knot.
        const b = subBounds([{ points: rectRing({ x0: 0, y0: 0, x1: 10, y1: 4 }, 50), closed: true }]);
        expect(b).toMatchObject({ x0: 0, y0: 0, x1: 10, y1: 4 });
    });

    it("approximates a circle to within the flattening tolerance", () => {
        const r = 20,
            a = circleRing(0, 0, r);
        for (const p of a) {
            expect(Math.hypot(p.x, p.y)).toBeCloseTo(r, 6);
        }
        // πr² = 1256.6; a flattened polygon is inscribed, so slightly under.
        const area = ringArea(a);
        expect(area).toBeLessThan(Math.PI * r * r);
        expect(area).toBeGreaterThan(Math.PI * r * r * 0.999);
    });

    it("spends more segments on a bigger arc, none on a degenerate one", () => {
        expect(arcSegments(50, Math.PI * 2)).toBeGreaterThan(arcSegments(5, Math.PI * 2));
        expect(arcSegments(0.001, Math.PI * 2)).toBe(2);
    });

    it("keeps an ellipse's own proportions, to the flattening tolerance", () => {
        // Segments are placed at uniform angle and sized for the major axis, so
        // the minor extreme is only hit when the count happens to divide by four
        // — inscribed by well under the 0.01 mm the curves are flattened to.
        const b = subBounds([{ points: ellipseRing(0, 0, 30, 10), closed: true }]);
        expect(b.x1 - b.x0).toBeGreaterThan(60 - FLATTEN_TOLERANCE);
        expect(b.x1 - b.x0).toBeLessThanOrEqual(60);
        expect(b.y1 - b.y0).toBeGreaterThan(20 - FLATTEN_TOLERANCE);
        expect(b.y1 - b.y0).toBeLessThanOrEqual(20);
    });

    it("reads fill by the even-odd rule the designs themselves render with", () => {
        const outer = rectRing({ x0: 0, y0: 0, x1: 10, y1: 10 }, 0);
        expect(inRing({ x: 5, y: 5 }, outer)).toBe(true);
        expect(inRing({ x: 15, y: 5 }, outer)).toBe(false);
    });

    it("drops the duplicate points a curve flattener emits", () => {
        const a = dedupe([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }]);
        expect(a).toHaveLength(2);
    });

    it("simplifies a ring without letting it collapse", () => {
        const a = circleRing(0, 0, 20),
            b = simplifyRing(a, 0.5);
        expect(b.length).toBeLessThan(a.length);
        expect(b.length).toBeGreaterThan(6);
        expect(ringArea(b)).toBeGreaterThan(ringArea(a) * 0.95);
    });
});

describe("buildStampKit", () => {
    const spec = { shape: "rect" as const, box: { x0: 0, y0: 0, x1: 60, y1: 30 }, radius: 0 };
    const kit = (handle: HandleType, thickness = 3) => buildStampKit(spec, { handle, thickness });

    it("cuts the base plate to the stamp's own size, whatever the handle", () => {
        for (const h of ["discs", "knob", "bar", "arch", "none"] as HandleType[]) {
            expect(kit(h).aPart[0]!.note).toContain("60 mm × 30 mm");
        }
    });

    it("makes the base plate the only part when no handle is wanted", () => {
        const o = kit("none");
        expect(o.aPart).toHaveLength(1);
        expect(o.handleHeight).toBe(0);
        expect(o.layers).toBe(0);
    });

    it("takes the layer count from the sheet rather than fixing it", () => {
        // A 20 mm grip is seven layers of 3 mm ply and three of 6 mm acrylic.
        expect(kit("discs", 3).layers).toBe(7);
        expect(kit("discs", 6).layers).toBe(3);
        expect(kit("discs", 3).handleHeight).toBeCloseTo(21, 6);
        expect(kit("discs", 6).handleHeight).toBeCloseTo(18, 6);
    });

    it("never asks for a stack too thin to hold or too silly to glue", () => {
        expect(kit("discs", 25).layers).toBe(2);
        expect(kit("discs", 0.5).layers).toBe(14);
    });

    it("grades the knob's diameters and leaves the plain stack alone", () => {
        expect(kit("knob").aPart[1]!.note).toContain("⌀ 22 mm down to ⌀ 12 mm");
        expect(kit("discs").aPart[1]!.note).toContain("⌀ 15 mm");
    });

    it("scales the bar to the stamp rather than overhanging it", () => {
        // 70 % of 60 mm, floored at the 30 mm minimum.
        expect(kit("bar").aPart[1]!.note).toContain("42 mm × 18 mm");
        const small = buildStampKit(
            { shape: "rect", box: { x0: 0, y0: 0, x1: 25, y1: 25 }, radius: 0 },
            { handle: "bar", thickness: 3 }
        );
        expect(small.aPart[1]!.note).toContain("30 mm");
    });

    it("stands the arch on two uprights, at a height the sheet does not set", () => {
        const o = kit("arch"),
            thick = kit("arch", 8);
        expect(o.aPart.map(x => x.label)).toEqual(["Base plate ×1", "Uprights ×2", "Grip bar ×1"]);
        expect(o.layers).toBe(0);
        // 25 mm upright plus the bar lying on top of it.
        expect(o.handleHeight).toBe(28);
        expect(thick.handleHeight).toBe(33);
    });

    it("has no cap to cut any more", () => {
        for (const h of ["discs", "knob", "bar", "arch"] as HandleType[]) {
            const labels = kit(h).aPart.map(o => o.label).join(" ");
            expect(labels).not.toMatch(/cap/i);
        }
    });

    it("warns when the handle does not fit on the plate it glues to", () => {
        const narrow = buildStampKit(
            { shape: "rect", box: { x0: 0, y0: 0, x1: 60, y1: 8 }, radius: 0 },
            { handle: "knob", thickness: 3 }
        );
        expect(narrow.warnings).toHaveLength(1);
        expect(narrow.warnings[0]).toContain("does not fit");
    });

    it("writes one sheet at true size in millimetres", () => {
        const o = kit("discs");
        expect(o.svg).toContain(`width="${Math.round(o.width * 1000) / 1000}mm"`);
        expect(o.width).toBeGreaterThan(0);
        expect(o.height).toBeGreaterThan(0);
    });
});

describe("laser conversion", () => {
    const d10 = getLaser("diode-10")!,
        d20 = getLaser("diode-20")!,
        d2 = getLaser("diode-2")!;

    it("halves the power when the target is twice as strong", () => {
        expect(convertSetting({ power: 100, speed: 300, passes: 1 }, d10, d20))
            .toMatchObject({ power: 50, speed: 300, passes: 1, flatOut: false });
    });

    it("keeps the energy per millimetre when the target cannot reach the power", () => {
        const o = convertSetting({ power: 100, speed: 300, passes: 1 }, d10, d2)!;
        expect(o.flatOut).toBe(true);
        expect(o.power).toBe(100);
        // 10 W at 300 mm/s is the same J/mm as 2 W at 60 mm/s.
        expect(o.speed * o.passes).toBeCloseTo(60, 0);
    });

    it("adds passes rather than crawling below the speed a controller stutters at", () => {
        const o = convertSetting({ power: 100, speed: 4, passes: 1 }, d20, d2)!;
        expect(o.passes).toBeGreaterThan(1);
        expect(o.speed).toBeGreaterThanOrEqual(2);
    });

    it("has nothing to convert without both a power and a speed", () => {
        expect(convertSetting({ speed: 300 }, d10, d20)).toBeUndefined();
        expect(convertSetting({ power: 80 }, d10, d20)).toBeUndefined();
    });

    it("matches a saved project to the nearest module of the right wavelength", () => {
        expect(detectLaser(10, "blue")).toBe("diode-10");
        expect(detectLaser(2, "ir")).toBe("ir-2");
        expect(detectLaser(6, "blue")).toBe("diode-5");
        expect(detectLaser(undefined, "blue")).toBe("");
    });
});
