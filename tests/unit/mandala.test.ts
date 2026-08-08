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
    seed: 1
};

const mandala = (patch: Partial<MandalaOptions> = {}) => buildMandala({ ...BASE, ...patch });

/** The eight that are one curve from a profile function. */
const BAND = ["petal", "lotus", "drop", "spoke", "scallop", "diamond", "dart"] as const;

/** The seven that are an assembly drawn in motif space. */
const COMPOSED = ["arrow", "star", "flower", "paisley", "crescent", "chevron", "fret"] as const;

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
