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
    it("draws all four, and each differently", () => {
        const aStyle = ["petal", "lotus", "drop", "spoke", "scallop", "diamond", "dart", "dots"] as const,
            svgs = aStyle.map(style => mandalaToSvg(mandala({ style })));
        expect(new Set(svgs).size).toBe(aStyle.length);
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
        for (const style of ["petal", "lotus", "drop", "spoke", "scallop", "diamond", "dart"] as const) {
            const r = mandala({ style, mode: "engrave", outline: false }),
                a = r.aLayer.find(l => l.filled)!.rings[0]!;
            expect(Math.hypot(a[0]!.x - a[a.length - 1]!.x, a[0]!.y - a[a.length - 1]!.y)).toBeLessThan(0.01);
        }
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
