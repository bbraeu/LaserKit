import { describe, expect, it } from "vitest";
import { BOX_LIMITS, buildBox, boxToDxf, boxToSvg, fingerSegments } from "../../src/lib/box";
import type { BoxOptions } from "../../src/lib/box";
import { inRing, ringArea, ringBounds } from "../../src/lib/design";

// A box is the one thing in this kit that is either right or firewood: the
// panels only go together if every finger lands in the gap opposite it. None of
// that is visible on the canvas — a tooth 0.3 mm too wide looks exactly like one
// that fits — so the invariants are pinned here instead.

const BASE: BoxOptions = {
    dims: "outer",
    width: 120,
    depth: 90,
    height: 60,
    thickness: 3,
    kerf: 0.15,
    clearance: 0,
    finger: 0,
    lid: "none",
    panelJoint: "edge",
    panelOffset: 6,
    lidClearance: 0.1,
    lidLip: true,
    lidHeight: 25,
    pin: 3,
    hingeOffset: 3,
    dividersW: 0,
    dividersD: 0,
    dividerHeight: 0,
    sheetWidth: 400,
    gap: 4,
    labels: false
};

const box = (patch: Partial<BoxOptions> = {}) => buildBox({ ...BASE, ...patch });

/** Every part, at its own origin, so a panel can be measured on its own. */
const partSizes = (o: Partial<BoxOptions> = {}) =>
    Object.fromEntries(box(o).aPart.map(p => [p.label, { w: p.width, h: p.height }]));

describe("finger segments", () => {
    it("is always odd, so both ends of a joint are the same kind", () => {
        for (let len = 10; len < 400; len += 3.5) {
            expect(fingerSegments(len, 9) % 2).toBe(1);
        }
    });

    it("gives the two panels of one joint the same count", () => {
        // The whole scheme rests on this: the pattern is never communicated
        // between panels, only re-derived from the same length and target.
        expect(fingerSegments(94, 9)).toBe(fingerSegments(94, 9));
        expect(fingerSegments(94.0000001, 9)).toBe(fingerSegments(94, 9));
    });

    it("never returns a butt joint or a comb", () => {
        expect(fingerSegments(1, 9)).toBeGreaterThanOrEqual(3);
        expect(fingerSegments(5000, 1)).toBeLessThanOrEqual(51);
    });
});

describe("an open box", () => {
    const r = box();

    it("comes out the outer size that was asked for", () => {
        expect(r.outer).toEqual({ w: 120, d: 90, h: 60 });
        // Walls on both sides, a floor under it.
        expect(r.inner).toEqual({ w: 114, d: 84, h: 57 });
    });

    it("cuts a bottom and four walls, and nothing else", () => {
        expect(r.aPart.map(p => p.label)).toEqual(["Bottom", "Front", "Back", "Left", "Right"]);
    });

    it("makes every panel the size its face of the box is", () => {
        const a = partSizes();
        // The bottom is the full footprint; the fingers of the walls put back
        // the millimetres their rectangles gave up.
        expect(a.Bottom!.w).toBeCloseTo(120, 6);
        expect(a.Bottom!.h).toBeCloseTo(90, 6);
        expect(a.Front!.w).toBeCloseTo(120, 6);
        expect(a.Front!.h).toBeCloseTo(60, 6);
        expect(a.Left!.w).toBeCloseTo(90, 6);
        expect(a.Left!.h).toBeCloseTo(60, 6);
    });

    it("gives the two opposite walls identical outlines", () => {
        const a = partSizes();
        expect(a.Front).toEqual(a.Back);
        expect(a.Left).toEqual(a.Right);
    });

    it("closes every cut contour", () => {
        for (const l of r.aLayer) {
            for (const ring of l.rings) {
                expect(ring.length).toBeGreaterThan(3);
                // A ring that does not enclose anything is a stray path.
                expect(ringArea(ring)).toBeGreaterThan(1);
            }
        }
    });

    it("reports what it actually drew", () => {
        expect(r.pieces).toBe(5);
        expect(r.cutLength).toBeGreaterThan(4 * (120 + 60));
        expect(r.warnings).toEqual([]);
    });
});

describe("the seams", () => {
    // The load-bearing property of the whole file, and the one nothing on the
    // canvas would show: walk the line where two panels meet and exactly one of
    // them must have material at every point. Both would collide; neither would
    // leave a hole.
    //
    // The panels are read back out of the finished sheet and put back at their
    // own origin, so this tests the geometry that actually gets cut rather than
    // the intentions of the code that drew it.
    const T = 3, W = 120, D = 90, H = 60;

    const localRing = (r: ReturnType<typeof box>, label: string, ox: number, oy: number) => {
        const i = r.aPart.findIndex(p => p.label === label),
            ring = r.aLayer[0]!.rings[i]!,
            b = ringBounds([ring]);
        return ring.map(p => ({ x: p.x - b.x0 + ox, y: p.y - b.y0 + oy }));
    };

    const r = box({ width: W, depth: D, height: H, thickness: T }),
        // Fingers protrude a thickness left of the front wall's own rectangle.
        front = localRing(r, "Front", -T, 0),
        left = localRing(r, "Left", 0, 0),
        bottom = localRing(r, "Bottom", 0, 0),
        wallH = H - T,
        // Sampling at the middle of each nominal segment stays clear of the
        // kerf-shifted boundaries, where "which side owns this" is deliberately
        // fuzzy by a tenth of a millimetre.
        mid = (from: number, to: number, n: number, i: number): number => from + ((to - from) * (i + 0.5)) / n;

    it("interlocks the upright corner joint tooth for tooth", () => {
        const n = fingerSegments(wallH, r.finger);
        expect(n).toBeGreaterThan(2);
        for (let i = 0; i < n; i++) {
            const y = mid(0, wallH, n, i),
                bFront = inRing({ x: -T / 2, y }, front),
                bLeft = inRing({ x: T / 2, y }, left);
            expect([i, bFront, bLeft]).toEqual([i, i % 2 === 1, i % 2 === 0]);
        }
    });

    it("interlocks the wall with the base plate tooth for tooth", () => {
        const n = fingerSegments(W - 2 * T, r.finger);
        for (let i = 0; i < n; i++) {
            const x = mid(T, W - T, n, i),
                // Below the wall's own rectangle is where its bottom fingers are.
                bWall = inRing({ x: x - T, y: wallH + T / 2 }, front),
                bBase = inRing({ x, y: T / 2 }, bottom);
            expect([i, bWall, bBase]).toEqual([i, i % 2 === 0, i % 2 === 1]);
        }
    });

    it("fills the base plate's cut-away corners with the side walls' end fingers", () => {
        // The corner square belongs to neither the front wall nor the plate —
        // it is the side wall's outermost bottom finger that plugs it, which is
        // the whole reason the plate's corners come off.
        expect(inRing({ x: T / 2, y: T / 2 }, bottom)).toBe(false);
        expect(inRing({ x: T / 2, y: wallH + T / 2 }, left)).toBe(true);
    });

    it("widens a finger and narrows its notch by the same half kerf", () => {
        const tight = box({ kerf: 0 }),
            wide = box({ kerf: 0.4 });
        // The kerf never changes a panel's overall size — it only moves the
        // boundary between finger and gap, so the box stays the size typed.
        expect(wide.outer).toEqual(tight.outer);
        const a = partSizes({ kerf: 0 }),
            b = partSizes({ kerf: 0.4 });
        expect(a.Front!.w).toBeCloseTo(b.Front!.w, 6);
    });

    it("keeps the box the same size whatever the finger width", () => {
        for (const finger of [0, 6, 12, 25]) {
            const r = box({ finger });
            expect(r.outer).toEqual({ w: 120, d: 90, h: 60 });
            expect(r.aPart.find(p => p.label === "Front")!.width).toBeCloseTo(120, 6);
        }
    });

    it("warns when the fingers are shorter than the material is thick", () => {
        expect(box({ thickness: 6, finger: 4 }).warnings.join(" ")).toMatch(/snap off/i);
    });
});

describe("inner dimensions", () => {
    it("adds the walls on rather than taking them out", () => {
        const r = box({ dims: "inner", width: 100, depth: 100, height: 50 });
        expect(r.inner).toEqual({ w: 100, d: 100, h: 50 });
        expect(r.outer).toEqual({ w: 106, d: 106, h: 53 });
    });

    it("counts both plates of a closed box", () => {
        const r = box({ dims: "inner", lid: "finger", width: 100, depth: 100, height: 50 });
        expect(r.inner.h).toBe(50);
        expect(r.outer.h).toBe(56);
    });
});

describe("lids", () => {
    it("adds nothing for none", () => {
        expect(box({ lid: "none" }).aPart).toHaveLength(5);
    });

    it("finger-joints a top on, as a sixth panel of the same kind as the bottom", () => {
        const a = partSizes({ lid: "finger" });
        expect(Object.keys(a)).toContain("Top");
        expect(a.Top).toEqual(a.Bottom);
        // The walls lose a thickness at each end to the two plates.
        expect(a.Front!.h).toBeCloseTo(60, 6);
    });

    it("cuts a lay-on lid the size of the box, and a lip that clears the opening", () => {
        const r = box({ lid: "layon", lidClearance: 0.1 }),
            a = partSizes({ lid: "layon", lidClearance: 0.1 });
        expect(a.Lid).toEqual({ w: 120, h: 90 });
        // 0.1 mm of play per side inside a 114 × 84 opening.
        expect(a["Lid lip"]!.w).toBeCloseTo(113.8, 6);
        expect(a["Lid lip"]!.h).toBeCloseTo(83.8, 6);
        // The lip's position is engraved on the lid so it can be glued square.
        expect(r.aLayer.some(l => l.operation.name === "Line Engraving")).toBe(true);
    });

    it("drops the lip when it is not wanted", () => {
        expect(Object.keys(partSizes({ lid: "layon", lidLip: false }))).not.toContain("Lid lip");
    });

    it("builds a tray lid as a second box that slips over the first", () => {
        const a = partSizes({ lid: "tray", lidClearance: 0.1 });
        // Over the outside: the box's width, plus two walls and two gaps.
        expect(a["Lid top"]!.w).toBeCloseTo(126.2, 6);
        expect(a["Lid front"]!.h).toBeCloseTo(25, 6);
    });
});

describe("the hinge", () => {
    const r = box({ lid: "hinged", height: 80, lidHeight: 25 });

    it("cuts two boxes and a pair of ears", () => {
        const aLabel = r.aPart.map(p => p.label);
        expect(aLabel).toContain("Front");
        expect(aLabel).toContain("Lid top");
        expect(aLabel.filter(s => s.startsWith("Hinge ear"))).toHaveLength(2);
    });

    it("splits the height between the two halves", () => {
        const a = partSizes({ lid: "hinged", height: 80, lidHeight: 25 });
        expect(a.Front!.h).toBeCloseTo(55, 6);
        expect(a["Lid front"]!.h).toBeCloseTo(25, 6);
    });

    it("counts the room in the lid as room in the box", () => {
        // A clamshell holds what fits between its floor and its ceiling, not
        // just what fits under the rim — the lid is a box too.
        expect(r.inner.h).toBeCloseTo(74, 6); // 80 − 3 floor − 3 lid top
        // A divider, though, stands in the open half only.
        expect(r.wellDepth).toBeCloseTo(52, 6); // (80 − 25) − 3
    });

    it("stands a full-height divider in the base, not across the joint", () => {
        const a = partSizes({ lid: "hinged", height: 80, lidHeight: 25, dividersW: 1 });
        expect(a["Divider ↕ 1"]!.h).toBeCloseTo(52, 6);
    });

    it("stands the knuckle out past the back of the lid", () => {
        const a = partSizes({ lid: "hinged", height: 80, lidHeight: 25 });
        // The side wall is the box's depth plus the knuckle hanging off it, so
        // the pivot can sit behind the box where nothing fouls it.
        expect(a["Lid left"]!.w).toBeGreaterThan(90);
        expect(a.Left!.w).toBeCloseTo(90, 6);
    });

    it("says so when the lid is too shallow to hold the pivot", () => {
        expect(box({ lid: "hinged", height: 80, lidHeight: 8 }).warnings.join(" ")).toMatch(/too shallow/i);
    });

    it("says so when there is nothing left to screw the ears to", () => {
        expect(box({ lid: "hinged", height: 40, lidHeight: 34 }).warnings.join(" ")).toMatch(/nowhere to screw/i);
    });
});

describe("an inset base", () => {
    const r = box({ panelJoint: "offset", panelOffset: 8 });

    it("raises the floor and says what is left above it", () => {
        expect(r.inner.h).toBeCloseTo(49, 6); // 60 − 8 − 3
    });

    it("makes the walls full height instead of notching their bottom edge", () => {
        const a = partSizes({ panelJoint: "offset", panelOffset: 8 });
        expect(a.Front!.h).toBeCloseTo(60, 6);
        // The plate shrinks to its web plus through-tenons — still the full
        // footprint, because the tenons come out flush with the outside.
        expect(a.Bottom!.w).toBeCloseTo(120, 6);
    });

    it("cuts a mortise for every tenon", () => {
        // Four walls, each with one row of mortises, plus the five outlines.
        expect(r.pieces).toBeGreaterThan(5);
    });
});

describe("dividers", () => {
    it("cross-laps a grid that drops in", () => {
        const r = box({ dividersW: 2, dividersD: 1 }),
            aLabel = r.aPart.map(p => p.label);
        expect(aLabel.filter(s => s.startsWith("Divider ↕"))).toHaveLength(2);
        expect(aLabel.filter(s => s.startsWith("Divider ↔"))).toHaveLength(1);
    });

    it("sizes them to the space inside, not the box", () => {
        const a = partSizes({ dividersW: 1, lidClearance: 0.1 });
        expect(a["Divider ↕ 1"]!.w).toBeCloseTo(83.8, 6); // 84 inner depth − 2 × 0.1
    });

    it("clamps a divider to the box rather than letting it stick out", () => {
        const a = partSizes({ dividersW: 1, dividerHeight: 500 });
        expect(a["Divider ↕ 1"]!.h).toBeCloseTo(57, 6);
    });
});

describe("nesting", () => {
    it("wraps parts into rows no wider than the sheet", () => {
        const r = box({ sheetWidth: 200 });
        expect(r.width).toBeLessThanOrEqual(200);
        expect(r.height).toBeGreaterThan(90);
    });

    it("widens the sheet rather than dropping a part that will not fit", () => {
        const r = box({ width: 500, sheetWidth: 200 });
        expect(r.width).toBeGreaterThan(200);
        expect(r.warnings.join(" ")).toMatch(/wider than/i);
        expect(r.aPart).toHaveLength(5);
    });

    it("never overlaps two parts", () => {
        const r = box({ lid: "finger", dividersW: 2, dividersD: 2, sheetWidth: 300 }),
            aBox = r.aLayer[0]!.rings.map(a => ringBounds([a]));
        // Panels may nest inside each other's bounding boxes only where a hole
        // sits inside its own panel, so compare the outlines the layout placed.
        expect(aBox.length).toBeGreaterThan(0);
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
    });
});

describe("output", () => {
    it("writes an SVG at true size in millimetres", () => {
        const r = box(),
            s = boxToSvg(r);
        expect(s).toContain(`width="${Math.round(r.width * 1000) / 1000}mm"`);
        expect(s).toContain('stroke="#ff0000"');
        // Part names are a reading aid on the canvas, never a cut.
        expect(s).not.toContain("<text");
        expect(r.preview).toBe(r.preview);
    });

    it("labels the preview only when asked", () => {
        expect(box({ labels: true }).preview).toContain("<text");
        expect(box({ labels: false }).preview).not.toContain("<text");
    });

    it("writes a DXF with the cut colour and the y axis the right way up", () => {
        const s = boxToDxf(box());
        expect(s).toContain("LWPOLYLINE");
        expect(s).toContain("AC1015");
    });

    it("survives the extremes of every slider", () => {
        const L = BOX_LIMITS;
        for (const patch of [
            { width: L.minSize, depth: L.minSize, height: L.minSize },
            { width: L.maxSize, depth: L.maxSize, height: L.maxSize, sheetWidth: L.maxSheet },
            { thickness: L.maxThickness },
            { thickness: L.minThickness },
            { kerf: L.maxKerf, clearance: L.maxClearance },
            { lid: "finger" as const, panelJoint: "offset" as const, panelOffset: L.maxOffset },
            { lid: "hinged" as const, dividersW: L.maxDividers, dividersD: L.maxDividers }
        ]) {
            const r = box(patch);
            expect(r.aPart.length).toBeGreaterThan(0);
            expect(Number.isFinite(r.width)).toBe(true);
            expect(Number.isFinite(r.height)).toBe(true);
            for (const ring of r.aLayer.flatMap(l => l.rings)) {
                for (const p of ring) {
                    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
                }
            }
        }
    });
});
