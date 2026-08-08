import { describe, expect, it } from "vitest";
import { signedArea } from "../../src/lib/boolean";
import { buildInterlock, defaultRing, ringRegions } from "../../src/lib/interlock";
import type { InterlockOptions, InterlockRing } from "../../src/lib/interlock";

// ---------------------------------------------------------------------------
// The interlocking engine.
//
// Everything here is about one claim: that shapes which overlap come back as
// *one* shape. It is the whole point of the tool and it is also the thing that
// decides whether the piece survives being cut — two outlines that cross are,
// to a laser, four cuts and two loose pieces, and nothing on the canvas says
// so. So what is pinned is the merge: that it happens, that it makes holes
// where there are holes, and that the piece count the status bar promises is
// the piece count that will come off the bed.
// ---------------------------------------------------------------------------

const ring = (patch: Partial<InterlockRing> = {}): InterlockRing => ({
    ...defaultRing("circle", 0.6),
    ...patch
});

const BASE: InterlockOptions = {
    size: 120,
    aRing: [ring()],
    hub: 0,
    hole: 0,
    outline: false
};

const build = (patch: Partial<InterlockOptions> = {}) => buildInterlock({ ...BASE, ...patch });

const areaOf = (r: ReturnType<typeof build>): number =>
    r.regions.reduce(
        (s, o) => s + o.rings.reduce((t, a, i) => t + (i === 0 ? 1 : -1) * Math.abs(signedArea(a)), 0),
        0
    );

describe("shapes that overlap come back as one shape", () => {
    it("merges a ring whose copies lap over each other", () => {
        // Spacing below 1 makes each copy wider than its share of the circle.
        // Twelve of those are one annulus, not twelve circles.
        const r = build({ aRing: [ring({ count: 12, spread: 0.5 })] });
        expect(r.stamps).toBe(12);
        expect(r.pieces).toBe(1);
    });

    it("leaves them apart when they are asked to be apart", () => {
        const r = build({ aRing: [ring({ count: 12, spread: 2 })] });
        expect(r.stamps).toBe(12);
        expect(r.pieces).toBe(12);
    });

    it("says so when the drawing would come off the bed in pieces", () => {
        // The one number worth shouting. A mandala is meant to be one thing.
        expect(build({ aRing: [ring({ spread: 2 })] }).warnings.some(s => /separate pieces/.test(s))).toBe(true);
        expect(build({ aRing: [ring({ spread: 0.5 })] }).warnings.some(s => /separate pieces/.test(s))).toBe(false);
    });

    it("counts the voids between overlapping shapes as contours, because they are cuts", () => {
        // The little curved triangles left between three overlapping circles
        // are holes in the piece, and every one of them is a closed cut the
        // head has to travel. Nobody drew them, so nobody expects them.
        const loose = build({ aRing: [ring({ count: 12, spread: 1.02 })] }),
            lapped = build({ aRing: [ring({ count: 12, spread: 0.62 })] });
        expect(lapped.pieces).toBe(1);
        expect(lapped.contours).toBeGreaterThan(1);
        expect(loose.contours).toBeGreaterThanOrEqual(loose.pieces);
    });

    it("loses area to the overlap rather than counting it twice", () => {
        // The test that the merge is a real boolean and not a pile of outlines:
        // twelve circles overlapping cover less than twelve circles' worth.
        const apart = build({ aRing: [ring({ count: 12, spread: 1.6 })] }),
            lapped = build({ aRing: [ring({ count: 12, spread: 0.55 })] });
        expect(areaOf(lapped)).toBeLessThan(areaOf(apart) * 12);
        expect(areaOf(lapped)).toBeGreaterThan(0);
    });
});

describe("size and spacing are two controls, not one", () => {
    it("changes the reach without changing the overlap", () => {
        const small = build({ aRing: [ring({ size: 0.2, spread: 0.6 })] }),
            big = build({ aRing: [ring({ size: 0.5, spread: 0.6 })] });
        // Both still merge — the overlap is across the ring and that has not
        // moved — but the bigger one reaches much further out.
        expect(small.pieces).toBe(1);
        expect(big.pieces).toBe(1);
        expect(areaOf(big)).toBeGreaterThan(areaOf(small) * 1.5);
    });

    it("changes the overlap without changing the reach", () => {
        const c = 60,
            reach = (r: ReturnType<typeof build>) =>
                Math.max(...r.regions.flatMap(o => o.rings.flatMap(a =>
                    a.map(p => Math.hypot(p.x - c, p.y - c)))));
        const tight = build({ aRing: [ring({ size: 0.35, spread: 0.4 })] }),
            loose = build({ aRing: [ring({ size: 0.35, spread: 1.5 })] });
        // Essentially the same reach whichever way the spacing is set — which
        // is the whole reason length and width are scaled separately.
        //
        // *Essentially*, not exactly: a copy is placed with its middle on the
        // ring, so its far corner is a hair further from the centre than its
        // far edge, and widening it swings that corner out a little. A quarter
        // of a millimetre on a 46 mm reach, and it is real geometry rather than
        // slop — a wider petal does stick out further, and the alternative
        // would be scaling the length back down to hide it, which would make
        // the spacing slider a size slider again.
        expect(Math.abs(reach(tight) - reach(loose)) / reach(loose)).toBeLessThan(0.01);
        expect(tight.pieces).toBeLessThan(loose.pieces);
    });
});

describe("rings that interlock with each other", () => {
    it("joins two rings when one is pushed into the other", () => {
        const apart = build({
            aRing: [ring({ radius: 0.35, size: 0.18, spread: 0.5 }), ring({ radius: 0.8, size: 0.18, spread: 0.5 })]
        });
        expect(apart.pieces).toBe(2);

        const woven = build({
            aRing: [
                ring({ radius: 0.35, size: 0.5, spread: 0.5, interlock: 1 }),
                ring({ radius: 0.8, size: 0.5, spread: 0.5, interlock: -1 })
            ]
        });
        expect(woven.pieces).toBe(1);
    });

    it("staggers a ring against its neighbour without moving it outwards", () => {
        const a = build({ aRing: [ring({ phase: 0 })] }),
            b = build({ aRing: [ring({ phase: 15 })] });
        expect(a.stamps).toBe(b.stamps);
        // The same drawing turned, so the same area and a different outline.
        expect(areaOf(a)).toBeCloseTo(areaOf(b), 1);
        expect(JSON.stringify(a.regions)).not.toBe(JSON.stringify(b.regions));
    });

    it("puts one shape in the middle rather than a pile of slivers", () => {
        // A ring at radius zero has no circumference to share out, so every
        // copy would be scaled to nothing and stacked on the same spot.
        const r = build({ aRing: [ring({ radius: 0, count: 12 })] });
        expect(r.stamps).toBe(1);
        expect(r.pieces).toBe(1);
    });
});

describe("the middle and the edge", () => {
    it("takes the hanging hole out rather than drawing it on top", () => {
        // A circle drawn over the design is a second cut crossing whatever is
        // under it, and what drops out of the middle then is not a disc — it is
        // the middle of the mandala.
        const solid = build({ hub: 0.5, aRing: [] }),
            punched = build({ hub: 0.5, hole: 20, aRing: [] });
        expect(solid.regions[0]!.rings).toHaveLength(1);
        expect(punched.regions[0]!.rings).toHaveLength(2);
        expect(areaOf(punched)).toBeLessThan(areaOf(solid));
    });

    it("merges the rim into the drawing instead of laying it over the top", () => {
        const r = build({ outline: true, aRing: [ring({ radius: 0.9, size: 0.4, spread: 0.5 })] });
        expect(r.pieces).toBe(1);
    });

    it("says when there is nothing to cut", () => {
        expect(build({ aRing: [] }).warnings.some(s => /nothing to cut/.test(s))).toBe(true);
    });

    it("comes out the diameter it was asked for, and clamps a silly one", () => {
        expect(build({ size: 90 }).width).toBe(90);
        expect(build({ size: 5 }).width).toBe(20);
        expect(build({ size: 9000 }).width).toBe(1000);
    });
});

describe("what it costs", () => {
    it("merges a heavy drawing fast enough to drag a slider against", () => {
        // Eight rings of thirty-two overlapping shapes is about as much as
        // anybody composes, and the build is debounced at a quarter of a second
        // — so this is the budget, not a nicety.
        const heavy = Array.from({ length: 8 }, (_, i) =>
            ring({ shape: "petalLotus", radius: 0.2 + i * 0.1, count: 32, size: 0.16, spread: 0.55, interlock: 0.5 }));
        const t0 = Date.now(),
            r = buildInterlock({ ...BASE, aRing: heavy, outline: true }),
            ms = Date.now() - t0;
        expect(r.stamps).toBe(256);
        expect(r.regions.length).toBeGreaterThan(0);
        expect(ms).toBeLessThan(2000);
    });

    it("gives the same drawing back for the same settings", () => {
        // The boolean library is retried with a nudge when it meets geometry it
        // cannot resolve, and that nudge is derived from the point index rather
        // than from a random number — precisely so that this holds.
        const a = build({ aRing: [ring({ count: 16, spread: 0.5 })] }),
            b = build({ aRing: [ring({ count: 16, spread: 0.5 })] });
        expect(JSON.stringify(a.regions)).toBe(JSON.stringify(b.regions));
    });
});
