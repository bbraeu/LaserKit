import { describe, expect, it } from "vitest";
import { buildMandala, mandalaToSvg } from "../../src/lib/mandala";
import type { MandalaOptions } from "../../src/lib/mandala";
import { ringBounds } from "../../src/lib/design";

// A mandala is decoration, so most of it is a matter of taste — but one thing
// is not. Cut, the pattern is holes in a disc, and holes that meet each other
// separate the disc into pieces. Nothing on the canvas shows that: a mandala
// that will fall into forty petals looks exactly like one that will not. So the
// web between motifs is what is pinned here.

const BASE: MandalaOptions = {
    size: 120,
    symmetry: 12,
    rings: 3,
    style: "petal",
    gap: 0.35,
    ringGap: 3,
    hub: 0.18,
    hole: 0,
    ringLines: false,
    outlined: false,
    nested: false,
    mode: "engrave",
    outline: true,
    seed: 1,
    bandFill: 1,
    layers: null
};

const mandala = (patch: Partial<MandalaOptions> = {}) => buildMandala({ ...BASE, ...patch });

/** The eight that are one curve from a profile function. */
const BAND = ["petal", "lotus", "drop", "spoke", "scallop", "diamond", "dart"] as const;

/** The seven that are an assembly drawn in motif space. */
const COMPOSED = [
    "arrow", "star", "flower", "paisley", "crescent", "chevron", "fret",
    "square", "hexagon", "star8", "rings", "lattice", "hatch", "ray",
    "spiral", "scurve", "vine"
] as const;

const ALL = [...BAND, "dots", ...COMPOSED] as const;

describe("the pattern", () => {
    it("repeats every ring the symmetry number of times", () => {
        expect(mandala({ symmetry: 12, rings: 3 }).motifs).toBe(36);
        expect(mandala({ symmetry: 8, rings: 5 }).motifs).toBe(40);
    });

    it("keeps everything inside the disc", () => {
        const r = mandala({ hole: 6 }),
            b = ringBounds(r.aLayer.flatMap(l => l.rings));
        expect(b.x0).toBeGreaterThanOrEqual(-0.01);
        expect(b.y0).toBeGreaterThanOrEqual(-0.01);
        expect(b.x1).toBeLessThanOrEqual(r.width + 0.01);
        expect(b.y1).toBeLessThanOrEqual(r.height + 0.01);
    });

    it("leaves the hub clear", () => {
        // Nothing may reach into the middle: it is what the rings hang off, and
        // where the hanging hole goes.
        const r = mandala({ hub: 0.3, hole: 0, outline: false, mode: "engrave" }),
            centre = { x: r.width / 2, y: r.height / 2 },
            motifs = r.aLayer.find(l => l.filled)!.rings;
        const nearest = Math.min(...motifs.flatMap(a =>
            a.map(p => Math.hypot(p.x - centre.x, p.y - centre.y))));
        expect(nearest).toBeGreaterThanOrEqual(0.3 * (r.width / 2) - 0.01);
    });

    it("turns every other ring half a slot, so the spokes do not line up", () => {
        // Two rings whose motifs sat at the same angles would read as spokes
        // rather than as a weave.
        const r = mandala({ rings: 2, symmetry: 8, mode: "engrave", outline: false }),
            motifs = r.aLayer.find(l => l.filled)!.rings,
            centre = { x: r.width / 2, y: r.height / 2 },
            angleOf = (a: { x: number; y: number }[]) => {
                const b = ringBounds([a]),
                    mx = (b.x0 + b.x1) / 2 - centre.x,
                    my = (b.y0 + b.y1) / 2 - centre.y;
                return Math.atan2(my, mx);
            };
        const inner = angleOf(motifs[0]!),
            outer = angleOf(motifs[8]!),
            half = Math.PI / 8;
        const turned = ((outer - inner) % (2 * half) + 2 * half) % (2 * half);
        expect(Math.abs(turned - half)).toBeLessThan(0.05);
    });
});

describe("the web, which is what holds a cut one together", () => {
    it("reports the narrowest material between two motifs", () => {
        // Geometry, not a guess: the slot is 2πr/n wide and the motif takes
        // (1 − gap) of it, so the web is gap × the slot at its fattest point.
        const r = mandala({ gap: 0.5, symmetry: 12, size: 120 });
        expect(r.web).toBeGreaterThan(0);
        // Twice the gap is about twice the web.
        expect(mandala({ gap: 0.5 }).web / mandala({ gap: 0.25 }).web).toBeCloseTo(2, 0);
    });

    it("shrinks the web as the symmetry rises", () => {
        expect(mandala({ symmetry: 32 }).web).toBeLessThan(mandala({ symmetry: 8 }).web);
    });

    it("says so when a cut mandala would come off the bed in pieces", () => {
        expect(mandala({ mode: "cut", gap: 0.06, symmetry: 40 }).warnings
            .some(s => /comes off the bed in \s*pieces|off the bed in/.test(s))).toBe(true);
        expect(mandala({ mode: "cut", gap: 0.5, symmetry: 8 }).warnings
            .some(s => /off the bed in/.test(s))).toBe(false);
    });

    it("says nothing about the web when it is only being engraved", () => {
        expect(mandala({ mode: "engrave", gap: 0.06, symmetry: 40 }).warnings
            .some(s => /off the bed in/.test(s))).toBe(false);
    });

    it("watches the gap between rings too", () => {
        expect(mandala({ mode: "cut", ringGap: 0.4 }).warnings.some(s => /they tear/.test(s))).toBe(true);
        expect(mandala({ mode: "cut", ringGap: 3 }).warnings.some(s => /they tear/.test(s))).toBe(false);
    });
});

describe("styles", () => {
    it("draws every one, and each differently", () => {
        const svgs = ALL.map(style => mandalaToSvg(mandala({ style })));
        expect(new Set(svgs).size).toBe(ALL.length);
    });

    it("mixes them from the seed, repeatably", () => {
        expect(mandalaToSvg(mandala({ style: "mixed", seed: 4 })))
            .toBe(mandalaToSvg(mandala({ style: "mixed", seed: 4 })));
        expect(mandalaToSvg(mandala({ style: "mixed", seed: 4 })))
            .not.toBe(mandalaToSvg(mandala({ style: "mixed", seed: 5 })));
    });

    it("closes every motif at both ends", () => {
        // The profile is 0 at t=0 and t=1 for every style, which is what makes
        // the two edges meet without a special case.
        for (const style of BAND) {
            const r = mandala({ style, mode: "engrave", outline: false }),
                a = r.aLayer.find(l => l.filled)!.rings[0]!;
            expect(Math.hypot(a[0]!.x - a[a.length - 1]!.x, a[0]!.y - a[a.length - 1]!.y)).toBeLessThan(0.01);
        }
    });
});

// ---------------------------------------------------------------------------
// The composed motifs.
//
// These exist because a profile function can only ever draw one convex curve,
// symmetric about its slot — a petal, a lens, a rhombus. It cannot draw a star
// (two radii), an arrow (not symmetric end to end) or a rosette (seven rings).
// So they are drawn in a little coordinate system of their own and mapped onto
// the band, and what has to be pinned is that the mapping keeps its promises:
// nothing leaves its ring, nothing reaches into the next slot, and the web the
// status bar reports is the web that is actually there.
// ---------------------------------------------------------------------------

/** Every point of a mandala in polar coordinates about its own middle. */
const polar = (r: ReturnType<typeof mandala>) => {
    const c = r.width / 2;
    return r.aLayer.flatMap(l => l.rings).flatMap(a => a.map(p => ({
        r: Math.hypot(p.x - c, p.y - c),
        a: Math.atan2(p.y - c, p.x - c)
    })));
};

describe("motifs that are an assembly rather than one curve", () => {
    it("draws every one of them", () => {
        for (const style of COMPOSED) {
            const r = mandala({ style, outline: false });
            expect(r.motifs, style).toBe(36);
            expect(r.points, style).toBeGreaterThan(0);
            expect(r.aLayer.flatMap(l => l.rings).length, style).toBeGreaterThanOrEqual(36);
        }
    });

    it("puts more than one ring in the ones that are little assemblies", () => {
        // A rosette is six petals and a middle; a paisley is a body and a dot.
        // Anything that came back with exactly one ring per repeat would mean
        // the assembly had quietly collapsed to its outline.
        for (const style of ["flower", "paisley"] as const) {
            const r = mandala({ style, outline: false, nested: false });
            expect(r.aLayer.flatMap(l => l.rings).length, style).toBeGreaterThan(r.motifs);
        }
    });

    it("keeps every one of them inside the disc and out of the hub", () => {
        for (const style of COMPOSED) {
            const r = mandala({ style, outline: false, hub: 0.25 }),
                R = r.width / 2,
                aP = polar(r);
            expect(Math.max(...aP.map(p => p.r)), style).toBeLessThanOrEqual(R + 0.01);
            // The hub is a plain disc, and a motif drawn into it is a motif
            // drawn over whatever is meant to be there.
            expect(Math.min(...aP.map(p => p.r)), style).toBeGreaterThanOrEqual(R * 0.25 - 0.01);
        }
    });

    it("never lets a motif reach into its neighbour's slot", () => {
        // This is the one that matters when the thing is cut. The shapes are
        // drawn at a fixed size in motif space and narrowed across the slot
        // only when symmetry demands it — so the test is whether that narrowing
        // is actually applied, at a symmetry high enough that it has to be.
        for (const style of COMPOSED) {
            const n = 24,
                gap = 0.35,
                r = mandala({ style, symmetry: n, rings: 1, hub: 0.3, gap, outline: false, nested: false }),
                half = Math.PI / n,
                // Not the whole slot: `gap` is the share of it that is meant to
                // stay material, and a motif that eats into that has taken the
                // web the status bar is promising.
                allowed = half * (1 - gap);
            for (const p of polar(r)) {
                const off = Math.abs(((p.a % (2 * half)) + 3 * half) % (2 * half) - half);
                expect(off, `${style} at r=${p.r.toFixed(1)}`).toBeLessThanOrEqual(allowed + 1e-6);
            }
        }
    });

    it("reports a web that is really there", () => {
        // The web is computed from the shape's widest point rather than
        // measured off the geometry, so it is worth checking the two agree.
        for (const style of COMPOSED) {
            const n = 16,
                r = mandala({ style, symmetry: n, rings: 1, hub: 0.3, gap: 0.2, outline: false, nested: false });
            expect(r.web, style).toBeGreaterThan(0);
            // The widest the drawing actually gets, as an angle either side of
            // its own centreline, times the radius it happens at.
            let worst = Infinity;
            for (const p of polar(r)) {
                const off = Math.abs(((p.a % ((2 * Math.PI) / n)) + (3 * Math.PI) / n) % ((2 * Math.PI) / n) - Math.PI / n);
                worst = Math.min(worst, 2 * ((Math.PI / n) - off) * p.r);
            }
            // Never optimistic: what is promised is at most what is there.
            expect(r.web, style).toBeLessThanOrEqual(worst + 0.5);
        }
    });

    it("puts a smaller copy inside the solid ones and leaves the thin ones alone", () => {
        // A half-size crescent lands in the *bite* of the moon, not in the
        // moon, and crosses the outline getting there. So the echo is for the
        // shapes that have an inside.
        for (const style of ["star", "arrow"] as const) {
            const plain = mandala({ style, nested: false, outline: false }),
                echoed = mandala({ style, nested: true, outline: false });
            expect(echoed.aLayer.flatMap(l => l.rings).length, style)
                .toBeGreaterThan(plain.aLayer.flatMap(l => l.rings).length);
        }
        for (const style of ["crescent", "chevron", "fret", "flower", "paisley"] as const) {
            const plain = mandala({ style, nested: false, outline: false }),
                echoed = mandala({ style, nested: true, outline: false });
            expect(mandalaToSvg(echoed), style).toBe(mandalaToSvg(plain));
        }
    });

    it("can turn up in a mixed mandala", () => {
        // Otherwise they would be seven motifs nobody ever sees, because mixed
        // is the default and the preset most people start from.
        const seen = new Set<string>();
        for (let seed = 1; seed <= 40; seed++) {
            seen.add(mandalaToSvg(mandala({ style: "mixed", seed, rings: 6 })));
        }
        expect(seen.size).toBeGreaterThan(30);
        // Six rings drawn from fifteen motifs: over forty seeds, at least one
        // has to differ from every all-band mandala.
        const bandOnly = new Set(BAND.map(style => mandalaToSvg(mandala({ style, rings: 6 }))));
        expect([...seen].every(s => bandOnly.has(s))).toBe(false);
    });
});

describe("cut and engrave", () => {
    it("engraves the motifs as areas and cuts them as holes", () => {
        expect(mandala({ mode: "engrave" }).aLayer.some(l => l.filled)).toBe(true);
        expect(mandala({ mode: "cut" }).aLayer.every(l => !l.filled)).toBe(true);
    });

    it("punches a hanging hole when it is asked for", () => {
        const without = mandala({ hole: 0 }).aLayer.flatMap(l => l.rings).length,
            withHole = mandala({ hole: 5 }).aLayer.flatMap(l => l.rings).length;
        expect(withHole).toBe(without + 1);
    });

    it("comes out the diameter asked for", () => {
        expect(mandala({ size: 90 }).width).toBe(90);
        expect(mandalaToSvg(mandala({ size: 90 }))).toContain('width="90mm"');
    });
});

// ---------------------------------------------------------------------------
// Bands, spacing and the stack.
// ---------------------------------------------------------------------------

/** How far out each ring of motifs sits, as [innermost radius, outermost]. */
const bandsOf = (r: ReturnType<typeof mandala>): [number, number][] => {
    const c = r.width / 2,
        all = r.aLayer.filter(l => l.operation.css !== "#ff0000").flatMap(l => l.rings);
    // Group by which ring a shape belongs to by its own middle radius, which is
    // enough here because the bands never overlap.
    return all.map(a => {
        const aR = a.map(p => Math.hypot(p.x - c, p.y - c));
        return [Math.min(...aR), Math.max(...aR)] as [number, number];
    });
};

describe("bands sized by what is in them", () => {
    it("gives a ring of dots less room than a ring of rosettes", () => {
        // Equal bands were the single thing that most made a generated mandala
        // look generated: a hand-drawn one is a stack of bands of different
        // heights, and a ring of dots given a rosette's room is mostly air.
        const r = mandala({ style: "mixed", layers: ["dots", "flower"], rings: 2, ringGap: 0, hub: 0.1 }),
            a = bandsOf(r),
            dots = a.filter(([lo]) => lo < r.width / 4),
            flowers = a.filter(([lo]) => lo >= r.width / 4),
            span = (b: [number, number][]) => Math.max(...b.map(o => o[1])) - Math.min(...b.map(o => o[0]));
        expect(span(dots)).toBeLessThan(span(flowers));
    });

    it("still fills the whole radius, whatever the mixture", () => {
        for (const layers of [["dots", "dots", "dots"], ["flower", "dots", "hatch"], ["fret", "spiral", "vine"]] as const) {
            const r = mandala({ layers: [...layers], rings: 3, hub: 0.2, ringGap: 2, outline: false }),
                R = r.width / 2,
                far = Math.max(...bandsOf(r).map(o => o[1]));
            // Within a whisker of the rim: the bands share out the space that
            // is there rather than each taking a fixed slice of it.
            expect(far, layers.join("+")).toBeGreaterThan(R * 0.93);
            expect(far, layers.join("+")).toBeLessThanOrEqual(R + 0.01);
        }
    });
});

describe("the space between the elements", () => {
    it("opens the motifs up sideways", () => {
        expect(mandala({ gap: 0.6 }).web).toBeGreaterThan(mandala({ gap: 0.15 }).web);
    });

    it("opens them up along the radius too, which the sideways one cannot", () => {
        // Two directions, two controls. A motif squeezed sideways but still
        // touching the top and bottom of its band reads as cramped whatever
        // the symmetry, and no value of `gap` reaches that.
        const tall = mandala({ bandFill: 1, rings: 2, ringGap: 0, hub: 0.1, outline: false }),
            short = mandala({ bandFill: 0.5, rings: 2, ringGap: 0, hub: 0.1, outline: false }),
            reach = (r: ReturnType<typeof mandala>) => {
                const a = bandsOf(r);
                return Math.max(...a.map(o => o[1])) - Math.min(...a.map(o => o[0]));
            };
        expect(reach(short)).toBeLessThan(reach(tall));
        // And it is reported, because on a cut mandala it is material.
        expect(short.ringWeb).toBeGreaterThan(tall.ringWeb);
    });

    it("never lets the height control push a motif out of the disc", () => {
        for (const bandFill of [0.3, 0.6, 1]) {
            const r = mandala({ bandFill, style: "mixed", rings: 4, seed: 3 }),
                R = r.width / 2;
            expect(Math.max(...polar(r).map(p => p.r)), String(bandFill)).toBeLessThanOrEqual(R + 0.01);
        }
    });
});

describe("the stack", () => {
    it("puts the motifs in the rings it was given, innermost first", () => {
        const r = mandala({ layers: ["dots", "flower", "fret"], rings: 3 });
        expect(r.aMotifKind).toEqual(["dots", "flower", "fret"]);
    });

    it("overrides the seed rather than being mixed with it", () => {
        const a = mandala({ style: "mixed", seed: 11, layers: ["star", "star", "star"], rings: 3 }),
            b = mandala({ style: "mixed", seed: 99, layers: ["star", "star", "star"], rings: 3 });
        expect(a.aMotifKind).toEqual(b.aMotifKind);
        expect(mandalaToSvg(a)).toBe(mandalaToSvg(b));
    });

    it("falls back to the seed for rings the stack does not reach", () => {
        // Turning the ring count up must not blank the new rings.
        const r = mandala({ style: "mixed", layers: ["dots", "flower"], rings: 5, seed: 2 });
        expect(r.aMotifKind).toHaveLength(5);
        expect(r.aMotifKind.slice(0, 2)).toEqual(["dots", "flower"]);
        expect(r.aMotifKind.slice(2).every(Boolean)).toBe(true);
    });

    it("is ignored entirely when there is none", () => {
        expect(mandala({ style: "petal", layers: null, rings: 3 }).aMotifKind).toEqual(["petal", "petal", "petal"]);
    });
});

// ---------------------------------------------------------------------------
// Motifs that overlap each other.
//
// The spacing slider goes below zero, and below zero a motif is wider than its
// own slot and laps over the one beside it. That is a drawing decision and a
// *cutting* decision at the same time: two outlines that cross are, to a laser,
// four cuts and two loose pieces — the head runs round motif A, through motif
// B, back out, and the little lens where they crossed drops out on its own.
// So the overlapping ones are merged into a single outline per ring, and what
// is pinned here is that the merge really happens.
// ---------------------------------------------------------------------------

/** Every ring of geometry the drawing would cut or burn. */
const drawn = (r: ReturnType<typeof mandala>): { x: number; y: number }[][] =>
    r.aLayer.flatMap(l => l.rings);

/** Do any two of these outlines cross? The thing a laser cannot survive. */
const anyCrossing = (aRing: { x: number; y: number }[][]): boolean => {
    const side = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
        Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const crosses = (p1: { x: number; y: number }, p2: { x: number; y: number },
        q1: { x: number; y: number }, q2: { x: number; y: number }) =>
        side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0;
    for (let i = 0; i < aRing.length; i++) {
        for (let j = i + 1; j < aRing.length; j++) {
            const A = aRing[i]!, B = aRing[j]!;
            for (let a = 0; a < A.length; a++) {
                for (let b = 0; b < B.length; b++) {
                    if (crosses(A[a]!, A[(a + 1) % A.length]!, B[b]!, B[(b + 1) % B.length]!)) return true;
                }
            }
        }
    }
    return false;
};

describe("motifs that lap over each other", () => {
    it("takes a spacing below zero", () => {
        const r = mandala({ gap: -0.5, rings: 1, symmetry: 10, nested: false });
        expect(r.motifs).toBe(10);
        expect(drawn(r).length).toBeGreaterThan(0);
    });

    it("merges them into one outline per ring instead of leaving them crossing", () => {
        // The whole point. Ten petals each half again as wide as its slot are
        // one closed contour, not ten overlapping ones.
        const lapped = mandala({ gap: -0.5, rings: 1, symmetry: 10, nested: false, outline: false, ringLines: false }),
            apart = mandala({ gap: 0.4, rings: 1, symmetry: 10, nested: false, outline: false, ringLines: false });
        expect(drawn(apart)).toHaveLength(10);
        expect(drawn(lapped).length).toBeLessThan(10);
    });

    it("leaves no crossing cut lines behind", () => {
        // Measured rather than assumed: every pair of outlines is tested for a
        // real segment crossing. This is the failure the merge exists to
        // prevent and it is invisible on the canvas.
        const r = mandala({
            gap: -0.6, rings: 1, symmetry: 9, nested: false, outline: false, ringLines: false, mode: "cut"
        });
        expect(anyCrossing(drawn(r))).toBe(false);
    });

    it("does not touch the drawing when the spacing is not negative", () => {
        // A merge at zero or above would be a few hundred polygons of work to
        // return what it was given, and would round every coordinate through
        // the boolean library on a tool whose output has been stable across
        // releases.
        const a = mandalaToSvg(mandala({ gap: 0.35 })),
            b = mandalaToSvg(mandala({ gap: 0.35 }));
        expect(a).toBe(b);
        expect(drawn(mandala({ gap: 0, rings: 1, symmetry: 8, nested: false, outline: false, ringLines: false })))
            .toHaveLength(8);
    });

    it("keeps the echo, which a careless merge would swallow whole", () => {
        // An echo sits entirely inside its parent, so a union of the two *is*
        // the parent. It has to be held back from the merge or the one thing
        // that turns a shape into a motif quietly disappears.
        const plain = mandala({ gap: -0.5, rings: 1, symmetry: 8, nested: false, outline: false, ringLines: false }),
            echoed = mandala({ gap: -0.5, rings: 1, symmetry: 8, nested: true, outline: false, ringLines: false });
        expect(drawn(echoed).length).toBe(drawn(plain).length + 8);
    });

    it("runs the dots into a chain rather than leaving them the one ring that ignores the slider", () => {
        const tight = mandala({ style: "dots", gap: -0.6, rings: 1, symmetry: 12, outline: false, ringLines: false }),
            loose = mandala({ style: "dots", gap: 0.4, rings: 1, symmetry: 12, outline: false, ringLines: false });
        expect(drawn(loose)).toHaveLength(12);
        expect(drawn(tight).length).toBeLessThan(12);
    });

    it("says what overlapping means for a cut one", () => {
        // The web is no longer what holds a ring together — there is none — so
        // the warning that talks about it would be answering a question nobody
        // asked, and the one that matters is about the rings.
        const r = mandala({ gap: -0.4, mode: "cut", symmetry: 24 });
        expect(r.warnings.some(s => /merged into one outline per ring/.test(s))).toBe(true);
        expect(r.warnings.some(s => /off the bed in/.test(s))).toBe(false);
    });
});
