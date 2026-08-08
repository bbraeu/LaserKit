import { describe, expect, it } from "vitest";
import { regionOf, signedArea, union } from "../../src/lib/boolean";
import type { Region } from "../../src/lib/boolean";
import {
    CELTIC_LIMITS,
    buildCelticTree,
    celticSheet,
    celticToSvg,
    leafRing
} from "../../src/lib/celtic";
import type { CelticOptions, CelticResult, Leaf } from "../../src/lib/celtic";
import type { Point } from "../../src/lib/dxf";

// ---------------------------------------------------------------------------
// The tree of life is decoration, and most of what it looks like is taste. Four
// things are not, and all four of them fail *silently* — the canvas shows a
// perfectly good tree in a ring in every one of these cases, and the bed shows
// something else.
//
//   1. Nothing may leave the outer circle. There is no clip in the builder any
//      more, deliberately: containment is a property of how the geometry is
//      constructed, and this file is what says so. A twig or a strand out past
//      the rim is a bulge on the edge of a disc that is supposed to be round.
//
//   2. The whole drawing has to come back from the union as ONE region. Two
//      regions means something is a separate piece of material, and what falls
//      out of the frame on the bed is the tree.
//
//   3. Every inner cutout has to be a *hole in* a region rather than an outline
//      of its own. A hole is a subpath under the even-odd rule; a separate
//      outline is a separate cut, and the difference does not show until
//      something fills the file or a nesting tool reads it.
//
//   4. The leaf floor is 4 mm and it is enforced rather than suggested. Under
//      it a cut leaf is a hole the size of the beam plus its own char.
//
// The rest of the file is about the two rules that are new: leaves are spread
// out rather than clumped, and a leaf that would be swallowed by what is
// already drawn is engraved instead of cut.
// ---------------------------------------------------------------------------

const BASE: CelticOptions = {
    size: 150,
    ringWidth: 12,
    knotDensity: 12,
    braidGap: 1.2,
    trunk: 10,
    sway: 0.5,
    branch: 7,
    depth: 4,
    density: 5,
    variance: 0.5,
    leaves: true,
    leafSize: 7,
    leafCount: 48,
    base: true,
    thickness: 3,
    kerf: 0.15,
    seed: 1
};

const tree = (patch: Partial<CelticOptions> = {}): CelticResult => buildCelticTree({ ...BASE, ...patch });

const centreOf = (r: CelticResult): Point => ({ x: r.size / 2, y: r.size / 2 });

/** Every point of every cut contour, which is what actually gets burnt. */
const cutPoints = (r: CelticResult): Point[] => r.aCut.flatMap(o => o.rings.flat());

/** True while the point is inside one of the tabs, which hang out on purpose. */
const inTab = (r: CelticResult) => (p: Point): boolean =>
    r.aTab.some(a => {
        const xs = a.map(q => q.x),
            ys = a.map(q => q.y);
        return p.x >= Math.min(...xs) - 0.01 && p.x <= Math.max(...xs) + 0.01
            && p.y >= Math.min(...ys) - 0.01 && p.y <= Math.max(...ys) + 0.01;
    });

/** How far the drawing reaches from the middle, the tabs discounted. */
const reachOf = (r: CelticResult): number => {
    const c = centreOf(r),
        tab = inTab(r);
    let far = 0;
    for (const p of cutPoints(r)) if (!tab(p)) far = Math.max(far, Math.hypot(p.x - c.x, p.y - c.y));
    return far;
};

/** Crossing number: whether a point is inside a closed ring. */
const inRing = (a: Point[], p: Point): boolean => {
    let inside = false;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
        const q = a[i]!,
            s = a[j]!;
        if ((q.y > p.y) !== (s.y > p.y) && p.x < ((s.x - q.x) * (p.y - q.y)) / (s.y - q.y) + q.x) inside = !inside;
    }
    return inside;
};

/** Outlines less the holes in them: the material that is actually left. */
const areaOf = (a: Region[]): number =>
    a.reduce((s, o) => s + o.rings.reduce((t, ring, i) => t + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0), 0);

const span = (a: Point[]) => ({
    w: Math.max(...a.map(p => p.x)) - Math.min(...a.map(p => p.x)),
    h: Math.max(...a.map(p => p.y)) - Math.min(...a.map(p => p.y))
});

const has = (r: CelticResult, re: RegExp): boolean => r.warnings.some(s => re.test(s));

// ---------------------------------------------------------------------------

describe("nothing leaves the disc", () => {
    it("keeps the whole cut drawing inside the circle it is supposed to be", { timeout: 120000 }, () => {
        // The builder has no clip in it. Containment comes from three separate
        // pieces of arithmetic — a limb is stopped at the reach circle half a
        // band inside the rim, the braid's crest touches the outer circle
        // exactly and an offset moves a point by at most half a width, and a
        // leaf that would cross the rim is dropped — and this is the test that
        // all three are still true. Measured on the *merged* rings rather than
        // on the centrelines, because it is the merged rings that get burnt.
        for (const size of [60, 150, 300, 400]) {
            for (const ringWidth of [4, 12, 24]) {
                for (const density of [2, 5, 10]) {
                    const r = tree({ size, ringWidth, density, base: false });
                    expect(reachOf(r), `⌀ ${size}, ring ${ringWidth}, ${density} primaries`)
                        .toBeLessThanOrEqual(r.size / 2 + 0.01);
                }
            }
        }
    });

    it("keeps it inside with the tabs on too, which are the only thing let out", () => {
        const r = tree({ base: true });
        expect(reachOf(r)).toBeLessThanOrEqual(r.size / 2 + 0.01);
        // And it does not simply pass because the tabs swallowed everything:
        // the drawing really does come right out to the rim.
        expect(reachOf(r)).toBeGreaterThan(r.size / 2 - 0.01);
    });

    it("says so rather than quietly shaving it off, if it ever does happen", () => {
        // The warning is the whole reason there is no clip. A clip would hide
        // the fault; this way the tool says the arithmetic has broken.
        for (const seed of [1, 2, 3]) expect(has(tree({ seed }), /past the edge of the disc/)).toBe(false);
    });

    it("throws away a leaf that would poke out through the ring", () => {
        // A leaf half in and half out of the band turns the outside edge of the
        // disc into a row of bumps, which is worse than one fewer leaf. Into
        // the band is fine and is the point.
        const r = tree({ leafSize: 20 }),
            c = centreOf(r);
        for (const o of [...r.aLeaf, ...r.aLeafMark]) {
            expect(Math.hypot(o.x - c.x, o.y - c.y) + o.length / 2).toBeLessThanOrEqual(r.size / 2 + 0.02);
        }
    });

    it("is as wide as the diameter asked for", () => {
        expect(tree({ size: 90 }).size).toBe(90);
        // And clamped to something cuttable rather than trusted.
        expect(tree({ size: 5 }).size).toBe(CELTIC_LIMITS.minSize);
        expect(tree({ size: 5000 }).size).toBe(CELTIC_LIMITS.maxSize);
    });
});

describe("it comes off the bed as one piece", () => {
    it("merges the whole drawing into a single region at the defaults", () => {
        const r = tree();
        expect(r.aCut).toHaveLength(1);
        expect(r.bJoined).toBe(true);
        // And it is one region because everything touches, not because it is
        // one blob: the openwork is there, as holes in that region.
        expect(r.holes).toBeGreaterThan(50);
    });

    it("stays one piece across the seeds and across the parameter space", { timeout: 120000 }, () => {
        // The structural rule is that every root reaches the ring and every
        // primary carries one chain that is forced out to it. Without those two
        // a seed now and then grows a quadrant of drooping twigs, the tree
        // hangs off three joins, and the thin ones tear.
        const bad: string[] = [];
        for (let seed = 1; seed <= 8; seed++) {
            for (const patch of [
                {},
                { density: 2, depth: 2 },
                { density: 10, depth: 5 },
                { ringWidth: 4 },
                { base: false },
                { trunk: 2, branch: 1 },
                { variance: 0 },
                { variance: 1 }
            ]) {
                const r = tree({ ...patch, seed });
                if (!r.bJoined) bad.push(`seed ${seed} ${JSON.stringify(patch)} → ${r.aCut.length}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it("counts the contours it is going to cut", () => {
        const r = tree();
        expect(r.pieces).toBe(r.aCut.length + r.holes);
        expect(r.pieces).toBe(r.aCut.reduce((n, o) => n + o.rings.length, 0));
    });
});

describe("every cutout is a hole, not another outline", () => {
    it("puts the openwork inside the outline rather than beside it", () => {
        // The difference between a hole and a second outline does not show on
        // screen, and does show the moment anything fills the file or a nesting
        // tool tries to place the piece.
        const r = tree(),
            o = r.aCut[0]!;
        expect(o.rings.length).toBeGreaterThan(1);
        for (const hole of o.rings.slice(1)) {
            for (const p of hole) expect(inRing(o.rings[0]!, p)).toBe(true);
        }
    });

    it("winds the holes against the outline, which is what even-odd is written for", () => {
        const o = tree().aCut[0]!,
            outer = Math.sign(signedArea(o.rings[0]!));
        expect(outer).not.toBe(0);
        for (const hole of o.rings.slice(1)) expect(Math.sign(signedArea(hole))).toBe(-outer);
    });

    it("leaves the biggest ring as the outline", () => {
        const o = tree().aCut[0]!,
            areas = o.rings.map(a => Math.abs(signedArea(a)));
        expect(areas[0]).toBe(Math.max(...areas));
    });

    it("cuts nothing that is too small to be a hole", { timeout: 120000 }, () => {
        // Where two strands touch almost tangentially, or a leaf's tip grazes
        // its own twig, the union is quite right to report a hole and the hole
        // is two tenths of a millimetre across. The beam is one tenth: what
        // that cuts is a scorch dot with a whole closed path spent on getting
        // to it, and with the braid gap closed up there are seventy of them.
        for (const patch of [{}, { braidGap: 0 }, { braidGap: 3 }, { size: 60, ringWidth: 6 }, { density: 10, depth: 5 }]) {
            const r = tree(patch);
            for (const o of r.aCut) {
                for (const ring of o.rings) {
                    expect(Math.abs(signedArea(ring)), JSON.stringify(patch)).toBeGreaterThanOrEqual(0.25);
                }
            }
        }
    });

    it("cuts real openwork between the strands of the plait", () => {
        // The gaps in the braid are the whole reason the braid gap control
        // exists, and they only become holes because of the two rims. Opening
        // the gap opens them up; closing it to nothing shuts them.
        const wide = tree({ braidGap: 3, leaves: false, density: 2, depth: 2 }),
            shut = tree({ braidGap: 0, leaves: false, density: 2, depth: 2 });
        expect(wide.holes).toBeGreaterThan(shut.holes);
    });
});

describe("the plaited frame", () => {
    it("splits the band into three strands with the gap taken out of each", () => {
        // The gap comes out of the strand rather than out of the ring, which is
        // what makes it read as "how much whitespace".
        for (const ringWidth of [6, 12, 24]) {
            for (const braidGap of [0, 1.2, 3]) {
                const r = tree({ ringWidth, braidGap });
                expect(r.ring.strand, `ring ${ringWidth}, gap ${braidGap}`)
                    .toBeCloseTo(Math.max(0.3, ringWidth / CELTIC_LIMITS.strands - braidGap), 6);
            }
        }
    });

    it("puts a rim at each edge of the band, and never nothing", () => {
        const r = tree({ ringWidth: 12 });
        expect(r.ring.rim).toBeGreaterThan(0);
        expect(r.ring.rim).toBeLessThan(r.ring.outer - r.ring.inner);
        expect(r.ring.outer - r.ring.inner).toBeCloseTo(12, 6);
        // Even on a band too narrow to deserve one, because a band with no rim
        // has no holes in it — only notches — and nothing for a branch to land
        // on.
        expect(tree({ ringWidth: 3 }).ring.rim).toBeGreaterThan(0);
    });

    it("holds the knot density where the whitespace would close up", () => {
        // A strand sweeps the band twice per loop, so past some density the
        // sweep is steeper than the strand is wide and consecutive passes
        // merge. The ceiling follows the circumference rather than being a
        // number typed into the limits.
        const tight = tree({ size: 60, ringWidth: 12, knotDensity: 40 });
        expect(tight.ring.lobes).toBeLessThan(40);
        expect(has(tight, /held to \d+ loops/)).toBe(true);

        const roomy = tree({ size: 400, ringWidth: 12, knotDensity: 20 });
        expect(roomy.ring.lobes).toBe(20);
        expect(has(roomy, /held to \d+ loops/)).toBe(false);
    });

    it("takes the loop count it is given, inside that ceiling", () => {
        expect(tree({ knotDensity: 7 }).ring.lobes).toBe(7);
        expect(tree({ knotDensity: 18 }).ring.lobes).toBe(18);
        expect(tree({ knotDensity: 1 }).ring.lobes).toBe(CELTIC_LIMITS.minKnot);
    });

    it("says when the gap has eaten the strands", () => {
        expect(has(tree({ ringWidth: 6, braidGap: 1.6 }), /gap has eaten the strands/)).toBe(true);
        expect(has(tree({ ringWidth: 12, braidGap: 1.2 }), /gap has eaten the strands/)).toBe(false);
    });
});

describe("the tree", () => {
    it("takes the trunk and the branches as two independent numbers", () => {
        // They used to be one: every branch was a fraction of the trunk, which
        // made a heavy trunk under fine branches impossible to draw. The trunk
        // is the first stroke in the list and the first primary is the second,
        // so the two numbers can be read straight off.
        for (const trunk of [4, 9, 20]) {
            for (const branch of [2, 5, 9]) {
                const r = tree({ trunk, branch });
                expect(r.aStroke[0]!.w0, `trunk ${trunk}`).toBeCloseTo(trunk * 2.2, 6);
                // Capped against the trunk, because a branch wider than the
                // thing it grows out of is not a tree.
                expect(r.aStroke[1]!.w0, `trunk ${trunk}, branch ${branch}`)
                    .toBeCloseTo(Math.min(branch, trunk * 1.6), 6);
            }
        }
        // And the twigs follow the branch control rather than the trunk one.
        expect(tree({ trunk: 9, branch: 9 }).thinnest).toBeGreaterThan(tree({ trunk: 9, branch: 2 }).thinnest);
    });

    it("refuses a branch wider than the trunk it grows out of", () => {
        const r = tree({ trunk: 2, branch: 20 });
        expect(Math.max(...r.aStroke.slice(1).map(s => s.w0))).toBeLessThanOrEqual(2 * 1.6 + 1e-9);
    });

    it("varies the taper from limb to limb, and does it the same way every time", () => {
        // Every limb at a level used to come out at exactly the same width. The
        // variation is on the taper rather than on the starting width, so a
        // limb still leaves its parent at the width its parent arrived at —
        // otherwise every fork has a visible step in it.
        const r = tree(),
            ratios = r.aStroke.slice(1).map(s => s.w1 / s.w0),
            lo = Math.min(...ratios),
            hi = Math.max(...ratios);
        expect(hi).toBeGreaterThan(lo * 1.2);
        expect(lo).toBeGreaterThanOrEqual(0.74 * 0.85 - 1e-9);
        expect(hi).toBeLessThanOrEqual(0.74 * 1.15 + 1e-9);
        // Deterministic: the seed is the whole of the tool's memory.
        expect(tree().aStroke.map(s => s.w1)).toEqual(r.aStroke.map(s => s.w1));
        expect(tree({ seed: 2 }).aStroke.map(s => s.w1)).not.toEqual(r.aStroke.map(s => s.w1));
    });

    it("grows more limbs with the density and with the depth", () => {
        expect(tree({ density: 8 }).branchCount).toBeGreaterThan(tree({ density: 3 }).branchCount);
        expect(tree({ depth: 5 }).branchCount).toBeGreaterThan(tree({ depth: 3 }).branchCount);
    });

    it("takes ten primaries now, and still merges into one piece at ten", () => {
        // The ceiling was five. Ten is the measured limit: the twig count is
        // density × 2^(depth−1), and past ten at four levels the tips are
        // closer together round the rim than the twigs are wide.
        expect(CELTIC_LIMITS.maxDensity).toBe(10);
        const r = tree({ density: 10 });
        expect(r.bJoined).toBe(true);
        expect(r.branchCount).toBeGreaterThan(tree({ density: 5 }).branchCount);
        // And it is clamped rather than trusted.
        expect(tree({ density: 40 }).branchCount).toBe(r.branchCount);
    });

    it("thins every level by about the same fraction, so depth is what makes twigs fragile", () => {
        expect(tree({ depth: 5 }).thinnest).toBeLessThan(tree({ depth: 4 }).thinnest);
        expect(tree({ branch: 12 }).thinnest).toBeGreaterThan(tree({ branch: 5 }).thinnest);
    });

    it("runs the roots into the band, every one of them", () => {
        // Roots are the anchor. A crown twig may droop and end in mid-air —
        // that is what makes a canopy read as grown — but a root that stops
        // short is the bottom of the disc held on by nothing.
        const r = tree(),
            c = centreOf(r);
        let deepest = 0;
        for (const s of r.aStroke) {
            for (const p of s.points) {
                const dx = p.x - c.x,
                    dy = p.y - c.y;
                // Off the trunk's own centreline, and pointing down.
                if (Math.abs(dx) > 2 && Math.atan2(Math.abs(dx), dy) < Math.PI * (40 / 180)) {
                    deepest = Math.max(deepest, Math.hypot(dx, dy));
                }
            }
        }
        // Into the band rather than onto its inner circle: a limb that stops on
        // the circle touches the frame at a tangent, and a tangent is not a
        // join once the beam has had its tenth of a millimetre.
        expect(deepest).toBeGreaterThan(r.ring.inner + r.ring.rim);
        expect(deepest).toBeLessThanOrEqual(r.ring.inner + (r.ring.outer - r.ring.inner) * 0.5 + 0.01);
    });

    it("anchors the trunk's sway at its foot so it stands square on the band", () => {
        // A trunk that leans from its own base looks like it is falling over.
        const straight = tree({ sway: 0 }),
            leaning = tree({ sway: 1 }),
            footOf = (r: CelticResult) => r.aStroke[0]!.points[0]!,
            drift = (r: CelticResult) =>
                Math.max(...r.aStroke[0]!.points.map(p => Math.abs(p.x - footOf(r).x)));
        expect(footOf(leaning).x).toBeCloseTo(footOf(straight).x, 6);
        expect(drift(leaning)).toBeGreaterThan(drift(straight) + 1);
        expect(drift(straight)).toBeCloseTo(0, 6);
    });

    it("gives the same tree back for the same seed, and a different one otherwise", () => {
        const key = (r: CelticResult) => JSON.stringify([r.aStroke, r.aLeaf, r.aLeafMark]);
        expect(key(tree({ seed: 4813 }))).toBe(key(tree({ seed: 4813 })));
        expect(key(tree({ seed: 4813 }))).not.toBe(key(tree({ seed: 4814 })));
    });
});

describe("the leaves", () => {
    const L = CELTIC_LIMITS;

    const placed = (r: CelticResult): Leaf[] => [...r.aLeaf, ...r.aLeafMark];

    it("draws the number asked for, up to what the twigs can hold", () => {
        for (const leafCount of [0, 6, 24, 48]) {
            expect(placed(tree({ leafCount })), `${leafCount} asked for`).toHaveLength(leafCount);
        }
        // And says so rather than silently drawing fewer when it runs out.
        const crowded = tree({ leafCount: 300 });
        expect(placed(crowded).length).toBeLessThan(300);
        expect(has(crowded, /leaves were asked for/)).toBe(true);
        expect(has(tree({ leafCount: 24 }), /leaves were asked for/)).toBe(false);
    });

    it("spaces them out instead of clumping them", () => {
        // The complaint this fixes is that leaves stick together in bunches,
        // because twigs arrive in bunches. Rejecting a candidate that is too
        // near one already drawn and trying the next one is the honest fix;
        // drawing fewer of them is not.
        for (const leafSize of [5, 7, 12]) {
            const r = tree({ leafSize }),
                a = placed(r);
            let nearest = Infinity;
            for (let i = 0; i < a.length; i++) {
                for (let j = i + 1; j < a.length; j++) {
                    nearest = Math.min(nearest, Math.hypot(a[i]!.x - a[j]!.x, a[i]!.y - a[j]!.y));
                }
            }
            expect(nearest, `leaf ${leafSize} mm`).toBeGreaterThanOrEqual(r.leafSize * 1.2 - 1e-9);
        }
    });

    it("hangs them off the ends of the twigs first", () => {
        // A tree with twelve leaves wants them at the ends of twelve twigs, not
        // clustered halfway along four of them.
        const few = tree({ leafCount: 12 }),
            c = centreOf(few),
            far = placed(few).map(o => Math.hypot(o.x - c.x, o.y - c.y));
        expect(Math.min(...far)).toBeGreaterThan(few.size * 0.12);
        expect(placed(tree({ leafCount: 48 })).length).toBeGreaterThan(placed(few).length);
    });

    it("engraves the ones that would be swallowed and cuts the rest", () => {
        // The point of the rule: merged into the union, a leaf lying across a
        // branch or across another leaf loses its own outline and the canopy
        // comes out as a lump. Engraved, you still see it.
        const r = tree();
        expect(r.markCount).toBeGreaterThan(0);
        expect(r.leafCount).toBeGreaterThan(0);
        expect(r.leafCount + r.markCount).toBe(placed(r).length);
        for (const o of r.aLeafMark) expect(r.aLeaf).not.toContain(o);
    });

    it("keeps the engraved ones out of the cut union entirely", () => {
        // Not merely drawn in a different colour: an engraved leaf contributes
        // no material at all. Adding them to the cut region afterwards makes it
        // bigger, which it could not do if they were already in it — and adding
        // the cut ones back changes nothing, because they are.
        const r = tree(),
            asRegion = (o: Leaf) => regionOf(leafRing(o));
        expect(areaOf(union([...r.aCut, ...r.aLeafMark.map(asRegion)])))
            .toBeGreaterThan(areaOf(r.aCut) * 1.002);
        expect(areaOf(union([...r.aCut, ...r.aLeaf.map(asRegion)])))
            .toBeCloseTo(areaOf(r.aCut), 3);
    });

    it("gives the engraved ones their own green layer and nothing else", () => {
        const r = tree(),
            sheet = celticSheet(r);
        expect(sheet.aLayer).toHaveLength(2);
        expect(sheet.aLayer[0]!.operation.css).toBe("#ff0000");
        expect(sheet.aLayer[1]!.operation.css).toBe("#00a000");
        expect(sheet.aLayer[1]!.rings).toHaveLength(r.markCount);
        // Nothing green at all when there is nothing to engrave.
        expect(celticSheet(tree({ leaves: false })).aLayer).toHaveLength(1);
    });

    it("grows a leaf that was asked for too small, and says so", () => {
        // Not a matter of taste: the beam and the char it leaves are each about
        // a tenth of a millimetre, so a 2 mm leaf is a hole not much bigger
        // than the hole that made it, and forty of them are a grey smudge.
        const r = tree({ leafSize: 2 });
        expect(r.leafSize).toBe(L.minLeaf);
        expect(has(r, /scorch marks/)).toBe(true);
        // Every leaf, not just the number that was typed in: they vary in size,
        // and they vary *upwards*, so the floor holds for all of them.
        for (const o of placed(r)) expect(o.length).toBeGreaterThanOrEqual(L.minLeaf);
    });

    it("says nothing when the leaves are big enough already", () => {
        const r = tree({ leafSize: L.minLeaf });
        expect(r.leafSize).toBe(L.minLeaf);
        expect(has(r, /scorch marks/)).toBe(false);
        expect(tree({ leafSize: 11 }).leafSize).toBe(11);
    });

    it("draws none at all when they are switched off", () => {
        const off = tree({ leaves: false });
        expect(off.leafCount).toBe(0);
        expect(off.markCount).toBe(0);
        expect(off.aLeaf).toHaveLength(0);
        expect(off.aLeafMark).toHaveLength(0);
        // And says nothing about a floor for leaves that do not exist.
        expect(has(tree({ leaves: false, leafSize: 1 }), /scorch marks/)).toBe(false);
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
        const r = tree({ base: true });
        for (const a of r.aTab) expect(Math.max(...a.map(p => p.y))).toBeGreaterThan(r.size);
        // And the drawing is that much taller than the disc, or the export
        // would crop the tabs off.
        expect(r.height).toBeGreaterThan(r.size);
        expect(r.height).toBe(Math.max(...r.aTab.flatMap(a => a.map(p => p.y))));
    });

    it("merges them into the disc rather than leaving them beside it", () => {
        // Touching the circle at a tangent would be a hairline joint, which is
        // no joint at all once the beam has had its tenth of a millimetre — so
        // they start inside the band, and the union is still one region.
        const r = tree({ base: true }),
            c = centreOf(r);
        for (const a of r.aTab) {
            const top = Math.min(...a.map(p => p.y)),
                x = a.reduce((s, p) => s + p.x, 0) / a.length;
            expect(Math.hypot(x - c.x, top - c.y)).toBeLessThan(r.ring.outer);
        }
        expect(r.aCut).toHaveLength(1);
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

    it("gives the backing disc the same tabs, so it stands in the same feet", () => {
        const r = tree({ base: true });
        expect(r.aBacking).toHaveLength(1);
        // One outline and no holes: it is the disc with nothing taken out.
        expect(r.aBacking[0]!.rings).toHaveLength(1);
        expect(Math.max(...r.aBacking[0]!.rings[0]!.map(p => p.y))).toBeCloseTo(r.height, 6);
        expect(tree({ base: false }).aBacking[0]!.rings[0]!.length).toBeGreaterThan(60);
    });
});

describe("what it writes out", () => {
    it("writes a hairline with no fill and the even-odd rule", () => {
        // A cut path has no width — the beam decides that — so the stroke is
        // only there to make the path visible. The even-odd rule is stated even
        // though there is no fill, because it is what decides whether the holes
        // are holes the moment anybody gives the file one to look at.
        const svg = celticToSvg(celticSheet(tree()));
        expect(svg).toContain('stroke-width="0.1"');
        expect(svg).toContain('fill="none"');
        expect(svg).toContain('fill-rule="evenodd"');
        expect(svg).toContain('stroke="#ff0000"');
        expect(svg).toContain('stroke="#00a000"');
    });

    it("puts every hole in the same path as the outline it belongs to", () => {
        // A hole written as a path of its own is a second cut, not a hole.
        const r = tree(),
            svg = celticToSvg(celticSheet(r)),
            paths = svg.match(/<path /g) ?? [],
            moves = (svg.match(/M-?[\d.]/g) ?? []).length;
        expect(paths).toHaveLength(2);
        expect(moves).toBe(r.pieces + r.markCount);
    });

    it("is as big as the drawing, tabs included", () => {
        const r = tree({ base: true }),
            svg = celticToSvg(celticSheet(r));
        expect(svg).toContain(`width="${r.size}mm"`);
        expect(svg).toContain(`height="${Math.round(r.height * 1000) / 1000}mm"`);
    });

    it("draws the stage in something you can see and the file in something you cannot", () => {
        // The preview is a picture and the export is a cut file: at the zoom a
        // whole disc fits at, a tenth of a millimetre is half a pixel.
        expect(celticToSvg(celticSheet(tree()), 0.3)).toContain('stroke-width="0.3"');
    });
});

describe("what it complains about", () => {
    it("says when the twigs would snap being lifted off the bed", () => {
        expect(has(tree({ branch: 1.5, depth: 6 }), /snap while you are lifting/)).toBe(true);
        expect(has(tree({ branch: 12, trunk: 20, depth: 3 }), /snap while you are lifting/)).toBe(false);
    });

    it("says when they are merely delicate", () => {
        // Two thresholds rather than one, because "fine in plywood, gone in
        // acrylic" is a real answer and refusing to draw it is not.
        const delicate = tree({ branch: 5, depth: 4, seed: 3 });
        expect(delicate.thinnest).toBeGreaterThanOrEqual(1);
        expect(delicate.thinnest).toBeLessThan(1.8);
        expect(has(delicate, /delicate in anything but plywood/)).toBe(true);
    });

    it("says when a thin sheet would make a tab that snaps in its slot", () => {
        expect(has(tree({ base: true, thickness: 1.5 }), /snaps in the slot/)).toBe(true);
        expect(has(tree({ base: true, thickness: 3 }), /snaps in the slot/)).toBe(false);
        expect(has(tree({ base: false, thickness: 1.5 }), /snaps in the slot/)).toBe(false);
    });

    it("says when there are more branches than there is disc to put them on", () => {
        const dense = tree({ density: 10, depth: 6 });
        expect(dense.branchCount).toBeGreaterThan(400);
        expect(has(dense, /on top of each other/)).toBe(true);
        expect(has(tree({ density: 2, depth: 3 }), /on top of each other/)).toBe(false);
    });
});

describe("how long it takes", () => {
    it("merges a whole tree fast enough that a slider still feels live", () => {
        // Measured rather than assumed, because this number decided the shape
        // of the geometry: merging every limb as a soup of quads and joint
        // discs took 810 ms, which makes every control in the tool feel broken,
        // and offsetting each centreline into one outline instead brought it to
        // about eighty. The budget here is generous — a CI runner is not the
        // user's machine — but an order of magnitude of regression trips it.
        buildCelticTree(BASE);
        const best = Math.min(...[1, 2, 3].map(seed => tree({ seed }).unionMs));
        expect(best).toBeLessThan(500);
    });

    it("reports what it actually took, so the tool can show it", () => {
        expect(tree().unionMs).toBeGreaterThan(0);
        expect(tree({ depth: 6, density: 10 }).unionMs).toBeGreaterThan(tree({ depth: 2, density: 2 }).unionMs);
    });
});
