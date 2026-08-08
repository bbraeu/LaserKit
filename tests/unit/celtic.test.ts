import { describe, expect, it } from "vitest";
import { CELTIC_LIMITS, buildCelticTree, leafRing } from "../../src/lib/celtic";
import type { CelticOptions, CelticResult } from "../../src/lib/celtic";

// ---------------------------------------------------------------------------
// The tree of life is decoration, and most of what it looks like is taste. Two
// things are not.
//
// The first is that the whole design is *centrelines with widths*, painted and
// traced into one silhouette by the tool. That only works while the centrelines
// are where they claim to be: a branch that wanders out through the rim comes
// back from the tracer as a lump on the outside of the disc, and a tab that
// stops short of the bottom of the circle comes back as a tab that never
// reaches its slot. Neither is visible on the canvas — both are visible on the
// bed. So containment is what most of this file is about.
//
// The second is the leaf floor. Every laser tool that draws leaves gets asked
// for smaller ones, and under about 4 mm a cut leaf is a hole the size of the
// beam plus its own char. The floor is enforced rather than suggested, and the
// test is that it stays that way.
// ---------------------------------------------------------------------------

const BASE: CelticOptions = {
    size: 150,
    branches: 3,
    depth: 4,
    twist: 0.5,
    trunk: 9,
    leaves: true,
    leafSize: 7,
    roots: true,
    border: "braid",
    borderWidth: 10,
    base: true,
    thickness: 3,
    kerf: 0.15,
    seed: 1
};

const tree = (patch: Partial<CelticOptions> = {}): CelticResult => buildCelticTree({ ...BASE, ...patch });

const centreOf = (r: CelticResult) => ({ x: r.size / 2, y: r.size / 2 });

/**
 * How far out the branches are allowed to grow, re-derived rather than
 * exported: with a ring they grow *into* it and stop 55 % of the way across the
 * band, and without one they stop just short of the edge.
 */
const reachOf = (r: CelticResult): number =>
    r.ring ? r.ring.inner + (r.ring.outer - r.ring.inner) * 0.55 : (r.size / 2) * 0.94;

/** Every centreline point, as a distance from the middle of the disc. */
const strokeRadii = (r: CelticResult): number[] => {
    const c = centreOf(r);
    return r.aStroke.flatMap(s => s.points.map(p => Math.hypot(p.x - c.x, p.y - c.y)));
};

/** The same, but as the painted stroke reaches — half a width either side. */
const paintedRadius = (r: CelticResult): number => {
    const c = centreOf(r);
    let worst = 0;
    for (const s of r.aStroke) {
        for (const p of s.points) worst = Math.max(worst, Math.hypot(p.x - c.x, p.y - c.y) + s.width / 2);
    }
    for (const o of r.aLeaf) {
        for (const p of leafRing(o)) worst = Math.max(worst, Math.hypot(p.x - c.x, p.y - c.y));
    }
    return worst;
};

const span = (a: { x: number; y: number }[]) => ({
    w: Math.max(...a.map(p => p.x)) - Math.min(...a.map(p => p.x)),
    h: Math.max(...a.map(p => p.y)) - Math.min(...a.map(p => p.y))
});

describe("nothing leaves the disc", () => {
    it("keeps every branch inside the circle the branches grow into", () => {
        // The failure this pins is a specific one and it is silent. Every fork
        // in the tree hands its children an allowance, and the chain of limbs
        // off one fork adds up to exactly that allowance — so the allowance is
        // the distance the outermost tip travels. Neither fork is in the middle
        // of the disc (the crown starts above it, the roots below), so a limb
        // leaving one sideways has most of a disc more room than one leaving it
        // outwards. Given a single number for all of them, the outward ones
        // walk out through the rim, and the traced silhouette then has twigs
        // sticking out past the edge of a disc that is supposed to be round.
        for (const twist of [0, 0.5, 1]) {
            for (const branches of [2, 3, 5]) {
                const r = tree({ twist, branches }),
                    reach = reachOf(r);
                expect(Math.max(...strokeRadii(r)), `twist ${twist}, ${branches} ways`)
                    .toBeLessThanOrEqual(reach + 0.01);
            }
        }
    });

    it("keeps the painted width inside the disc too, not just the centreline", () => {
        // A centreline inside the rim is not enough: the stroke is painted at
        // its full width, so the thing that has to fit is the centreline plus
        // half a branch. The trunk is the widest stroke in the drawing and it
        // is the one that used to bulge, because with the roots switched off it
        // ran all the way down to the same reach a hairline twig does.
        for (const size of [60, 150, 300]) {
            for (const roots of [true, false]) {
                for (const border of ["plain", "braid", "knot"] as const) {
                    const r = tree({ size, roots, border, borderWidth: Math.max(6, size * 0.07) });
                    expect(paintedRadius(r), `⌀ ${size}, roots ${roots}, ${border}`)
                        .toBeLessThanOrEqual(r.size / 2 + 0.01);
                }
            }
        }
    });

    it("throws away leaves that would poke out through the ring", () => {
        // A leaf half in and half out of the band turns the outside edge of the
        // disc into a row of bumps, which is worse than one fewer leaf.
        const r = tree({ leafSize: 25 }),
            c = centreOf(r),
            reach = reachOf(r);
        for (const o of r.aLeaf) {
            expect(Math.hypot(o.x - c.x, o.y - c.y) + o.length / 2).toBeLessThanOrEqual(reach + 0.02);
        }
    });

    it("is as wide as the diameter asked for", () => {
        expect(tree({ size: 90 }).size).toBe(90);
        // And clamped to something cuttable rather than trusted.
        expect(tree({ size: 5 }).size).toBe(CELTIC_LIMITS.minSize);
        expect(tree({ size: 5000 }).size).toBe(CELTIC_LIMITS.maxSize);
    });
});

describe("the leaf floor", () => {
    const L = CELTIC_LIMITS;

    it("grows a leaf that was asked for too small, and says so", () => {
        // Not a matter of taste: the beam and the char it leaves are each about
        // a tenth of a millimetre, so a 2 mm leaf is a hole not much bigger
        // than the hole that made it, and forty of them are a grey smudge.
        const r = tree({ leafSize: 2 });
        expect(r.leafSize).toBe(L.minLeaf);
        expect(r.warnings.some(s => /scorch marks/.test(s))).toBe(true);
        // Every leaf, not just the number that was typed in: they vary in
        // size, and they vary *upwards*, so the floor holds for all of them.
        for (const o of r.aLeaf) expect(o.length).toBeGreaterThanOrEqual(L.minLeaf);
    });

    it("says nothing when the leaves are big enough already", () => {
        const r = tree({ leafSize: L.minLeaf });
        expect(r.leafSize).toBe(L.minLeaf);
        expect(r.warnings.some(s => /scorch marks/.test(s))).toBe(false);
    });

    it("leaves a bigger leaf alone", () => {
        expect(tree({ leafSize: 11 }).leafSize).toBe(11);
    });

    it("draws none at all when they are switched off", () => {
        expect(tree({ leaves: false }).leafCount).toBe(0);
        expect(tree({ leaves: false }).aLeaf).toHaveLength(0);
        // And says nothing about a floor for leaves that do not exist.
        expect(tree({ leaves: false, leafSize: 1 }).warnings.some(s => /scorch marks/.test(s))).toBe(false);
    });
});

describe("how much tree there is", () => {
    it("grows the branch count with the number of ways each limb splits", () => {
        expect(tree({ branches: 4 }).branchCount).toBeGreaterThan(tree({ branches: 2 }).branchCount);
    });

    it("grows it with the depth too", () => {
        expect(tree({ depth: 5 }).branchCount).toBeGreaterThan(tree({ depth: 3 }).branchCount);
    });

    it("thins every level by the same fraction, so depth is what makes twigs fragile", () => {
        // Each limb is 72 % of its parent's width. That is where the thinnest
        // twig comes from, and it is why adding a level is not free.
        expect(tree({ depth: 5 }).thinnest).toBeLessThan(tree({ depth: 4 }).thinnest);
        expect(tree({ trunk: 18 }).thinnest).toBeGreaterThan(tree({ trunk: 9 }).thinnest);
    });

    it("fills the bottom of the disc only when the roots are on", () => {
        // Crown limbs dip below the middle whichever way this is set — the
        // outermost pair lie almost flat and their children fan downwards, which
        // is what fills the shoulders. So the test is the *bottom sector*: with
        // no roots the only thing within forty degrees of straight down is the
        // trunk running into the band on its own, and everything either side of
        // it is bare.
        const bottom = (r: CelticResult): number => {
            const c = centreOf(r);
            let far = 0;
            for (const s of r.aStroke) {
                for (const p of s.points) {
                    const dx = p.x - c.x,
                        dy = p.y - c.y;
                    // Off the trunk's own centreline, and pointing down.
                    if (Math.abs(dx) > 2 && Math.atan2(Math.abs(dx), dy) < Math.PI * (40 / 180)) {
                        far = Math.max(far, Math.hypot(dx, dy));
                    }
                }
            }
            return far;
        };
        expect(tree({ roots: false }).branchCount).toBeLessThan(tree({ roots: true }).branchCount);
        // A comparison rather than "nothing at all down there". The flattest
        // crown primaries leave the trunk well below the middle now — that is
        // what fills the shoulders — so a few of their first points fall inside
        // a sector measured from the centre whether there are roots or not.
        // What roots do is reach the *rim* along the bottom, and that is the
        // thing worth pinning.
        const bare = tree({ roots: false });
        expect(bottom(bare)).toBeLessThan(bare.size / 2 * 0.5);
        // And with them on the roots are *into the band*, so the disc is held
        // from below as well as over the top. Into the band rather than onto
        // the reach circle: limbs bend towards the horizontal as they grow, so
        // the deepest one arrives a millimetre or so inside where a limb that
        // grew straight would have — which is a join either way, because the
        // band has depth. Asking for the reach circle exactly would be asking
        // for one root that never bent at all.
        const rooted = tree({ roots: true });
        expect(bottom(rooted)).toBeGreaterThan(rooted.ring!.inner);
        expect(bottom(rooted)).toBeLessThanOrEqual(reachOf(rooted) + 0.01);
    });

    it("gives the same tree back for the same seed, and a different one otherwise", () => {
        // The seed is the whole of the tool's memory: somebody who liked tree
        // 4813 has nothing else to go back to.
        const key = (r: CelticResult) => JSON.stringify([r.aStroke, r.aLeaf]);
        expect(key(tree({ seed: 4813 }))).toBe(key(tree({ seed: 4813 })));
        expect(key(tree({ seed: 4813 }))).not.toBe(key(tree({ seed: 4814 })));
    });
});

describe("the border", () => {
    it("has no ring and no decoration at all when there is none", () => {
        const r = tree({ border: "none" });
        expect(r.ring).toBeNull();
        expect(r.aBorderLine).toHaveLength(0);
    });

    it("gives a plain band a ring but nothing engraved into it", () => {
        // A plain band is the strongest of the four precisely because nothing
        // is taken out of it.
        const r = tree({ border: "plain" });
        expect(r.ring).not.toBeNull();
        expect(r.aBorderLine).toHaveLength(0);
    });

    it("weaves two strands for a braid and three for a rope", () => {
        expect(tree({ border: "braid" }).aBorderLine).toHaveLength(2);
        expect(tree({ border: "rope" }).aBorderLine).toHaveLength(3);
    });

    it("puts a ring at every crossing of a knot", () => {
        // Two strands plus two dots per lobe. Anything else means the dots have
        // drifted off the crossings, which is what turns knotwork back into a
        // sine wave.
        const r = tree({ border: "knot" });
        expect(r.aBorderLine.length).toBeGreaterThan(2);
        expect((r.aBorderLine.length - 2) % 2).toBe(0);
    });

    it("scales the number of lobes with the circumference, not with a knob", () => {
        // A knot with the same number of crossings at 60 mm and at 300 mm is
        // either a scribble or a row of sausages, and never both right. Same
        // band width, three times the circle: about three times the crossings.
        const small = tree({ size: 100, border: "knot", borderWidth: 10 }).aBorderLine.length - 2,
            big = tree({ size: 300, border: "knot", borderWidth: 10 }).aBorderLine.length - 2;
        expect(big).toBeGreaterThan(small * 2);
    });

    it("keeps the decoration inside the band it is engraved into", () => {
        // It is engraved rather than cut, so it may not stray out over the edge
        // of the piece or in over the branches.
        const r = tree({ border: "rope" }),
            c = centreOf(r);
        for (const a of r.aBorderLine) {
            for (const p of a) {
                const d = Math.hypot(p.x - c.x, p.y - c.y);
                expect(d).toBeLessThanOrEqual(r.ring!.outer + 0.01);
                expect(d).toBeGreaterThanOrEqual(r.ring!.inner - 0.01);
            }
        }
    });
});

describe("standing it up", () => {
    it("cuts nothing extra until the base is asked for", () => {
        const r = tree({ base: false });
        expect(r.aTab).toHaveLength(0);
        expect(r.feet).toBeNull();
        expect(r.height).toBe(r.size);
    });

    it("hangs two tabs off the rim, one either side of the middle", () => {
        const r = tree({ base: true }),
            c = centreOf(r);
        expect(r.aTab).toHaveLength(2);
        const mid = r.aTab.map(a => a.reduce((s, p) => s + p.x, 0) / a.length);
        expect(mid[0]! + mid[1]!).toBeCloseTo(2 * c.x, 6);
        expect(Math.abs(mid[0]! - mid[1]!)).toBeGreaterThan(r.size * 0.5);
    });

    it("hangs them below the bottom of the circle, not below where they left the rim", () => {
        // This is the one that silently does not work. A tab at half a radius
        // across starts a good way above the bottom of the disc, so a tab
        // measured from *there* is shorter than the rim it has to clear: the
        // disc lands on its own edge and the slots never see it.
        const r = tree({ base: true }),
            bottom = r.size;
        for (const a of r.aTab) {
            expect(Math.max(...a.map(p => p.y))).toBeGreaterThan(bottom);
        }
        // And the drawing is that much taller than the disc, or the export
        // would crop the tabs off.
        expect(r.height).toBeGreaterThan(r.size);
        expect(r.height).toBe(Math.max(...r.aTab.flatMap(a => a.map(p => p.y))));
    });

    it("starts them inside the ring so they merge with it", () => {
        // Touching the circle at a tangent would be a hairline joint, which is
        // no joint at all once the beam has had its tenth of a millimetre.
        const r = tree({ base: true, border: "plain", borderWidth: 10 }),
            c = centreOf(r);
        for (const a of r.aTab) {
            const top = Math.min(...a.map(p => p.y)),
                x = a.reduce((s, p) => s + p.x, 0) / a.length;
            expect(Math.hypot(x - c.x, top - c.y)).toBeLessThan(r.ring!.outer);
        }
    });

    it("cuts the slot in each foot to the sheet plus the kerf", () => {
        // A slot cut to the nominal thickness is a slot the tab does not go
        // into: the beam took its width out of the tab on the way past.
        for (const kerf of [0, 0.15, 0.4]) {
            const r = tree({ base: true, thickness: 3, kerf }),
                // Per foot: the plate, then the slot in it.
                slot = span(r.feet!.rings[1]!),
                tab = span(r.aTab[0]!);
            expect(slot.h, `kerf ${kerf}`).toBeCloseTo(3 + kerf, 6);
            expect(slot.w, `kerf ${kerf}`).toBeCloseTo(tab.w + kerf, 6);
        }
    });

    it("lays the two feet out side by side without overlapping", () => {
        // They go out as one file, so they have to be one file you can cut
        // rather than two shapes on top of each other.
        const r = tree({ base: true }),
            feet = r.feet!;
        expect(feet.rings).toHaveLength(4);
        const right0 = Math.max(...feet.rings[0]!.map(p => p.x)),
            left1 = Math.min(...feet.rings[2]!.map(p => p.x));
        expect(left1).toBeGreaterThan(right0);
        for (const a of feet.rings) {
            expect(Math.max(...a.map(p => p.x))).toBeLessThanOrEqual(feet.width + 0.01);
            expect(Math.max(...a.map(p => p.y))).toBeLessThanOrEqual(feet.height + 0.01);
        }
    });
});

describe("what it complains about", () => {
    const has = (r: CelticResult, re: RegExp) => r.warnings.some(s => re.test(s));

    it("says when the twigs would snap being lifted off the bed", () => {
        expect(has(tree({ trunk: 2, depth: 6 }), /snap while you are lifting/)).toBe(true);
        expect(has(tree({ trunk: 18, depth: 3 }), /snap while you are lifting/)).toBe(false);
    });

    it("says when they are merely delicate", () => {
        // Two thresholds rather than one, because "fine in plywood, gone in
        // acrylic" is a real answer and refusing to draw it is not.
        const delicate = tree({ trunk: 6, depth: 5 });
        expect(delicate.thinnest).toBeGreaterThanOrEqual(1);
        expect(delicate.thinnest).toBeLessThan(1.8);
        expect(has(delicate, /delicate in anything but plywood/)).toBe(true);
    });

    it("says that a tree with no border has nothing holding it together", () => {
        expect(has(tree({ border: "none" }), /end in mid-air/)).toBe(true);
        expect(has(tree({ border: "plain" }), /end in mid-air/)).toBe(false);
    });

    it("says that a base with no border is two loose rectangles", () => {
        // The tabs hang off the rim. With no rim they hang off nothing, and
        // nothing in the drawing says so.
        expect(has(tree({ base: true, border: "none" }), /loose rectangles/)).toBe(true);
        expect(has(tree({ base: false, border: "none" }), /loose rectangles/)).toBe(false);
        expect(has(tree({ base: true, border: "braid" }), /loose rectangles/)).toBe(false);
    });

    it("says that knotwork in a narrow band engraves as a smudge", () => {
        // The crossings end up closer together than the beam is wide, which is
        // a property of the band width rather than of the disc.
        expect(has(tree({ border: "knot", borderWidth: 4 }), /engraves as a smudge/)).toBe(true);
        expect(has(tree({ border: "knot", borderWidth: 12 }), /engraves as a smudge/)).toBe(false);
        expect(has(tree({ border: "braid", borderWidth: 4 }), /engraves as a smudge/)).toBe(false);
    });

    it("says when a thin sheet would make a tab that snaps in its slot", () => {
        expect(has(tree({ base: true, thickness: 1.5 }), /snaps in the slot/)).toBe(true);
        expect(has(tree({ base: true, thickness: 3 }), /snaps in the slot/)).toBe(false);
        expect(has(tree({ base: false, thickness: 1.5 }), /snaps in the slot/)).toBe(false);
    });

    it("says when there are more branches than there is disc to put them on", () => {
        const dense = tree({ branches: 5, depth: 6 });
        expect(dense.branchCount).toBeGreaterThan(400);
        expect(has(dense, /lie on \s*top of each other|on top of each other/)).toBe(true);
        expect(has(tree({ branches: 2, depth: 3 }), /on top of each other/)).toBe(false);
    });
});
