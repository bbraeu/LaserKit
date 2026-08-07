import { describe, expect, it } from "vitest";
import { HINGE_LIMITS, buildHinge, hingeToDxf, hingeToSvg } from "../../src/lib/hinge";
import type { HingeOptions } from "../../src/lib/hinge";
import { ringBounds } from "../../src/lib/design";

// A living hinge is either a panel that bends or a panel that falls into
// strips, and nothing on the canvas tells the two apart: a pattern one
// millimetre away from cutting itself through looks exactly like one that
// holds. So the invariants are pinned here — no cut ever crosses the panel, no
// slit ever leaves it, and the twist the rows are asked for is the twist the
// arithmetic promises.

const BASE: HingeOptions = {
    width: 120,
    height: 80,
    bendAxis: "vertical",
    pattern: "straight",
    pitch: 5,
    link: 5,
    slit: 25,
    inset: 0,
    flat: 0,
    thickness: 3,
    kerf: 0.15,
    radius: 40,
    outline: true,
    amplitude: 0.25
};

const hinge = (patch: Partial<HingeOptions> = {}) => buildHinge({ ...BASE, ...patch });

/** Every slit, as its own bounding box. */
const slits = (patch: Partial<HingeOptions> = {}) => hinge(patch).rings.map(a => ringBounds([a]));

describe("the field of slits", () => {
    it("fills the panel with rows across the bend", () => {
        const r = hinge({ width: 120, pitch: 5 });
        expect(r.rows).toBe(24);
        expect(r.pitch).toBeCloseTo(5);
    });

    it("rounds the rows to fit rather than leaving a stub at one edge", () => {
        // 120 mm at a 7 mm target is 17.14 rows; 17 of them, 7.06 mm apart.
        const r = hinge({ width: 120, pitch: 7 });
        expect(r.rows).toBe(17);
        expect(r.pitch * r.rows).toBeCloseTo(120);
    });

    it("holds the link exactly and gives way on the slit length", () => {
        // The link is what carries the load, so it is the number worth setting;
        // the slit is what absorbs the rounding.
        for (const height of [60, 73, 91.5, 140]) {
            const r = hinge({ height, link: 4 });
            // A column of m slits and m−1 links spans m(s+l) − l = the run.
            const m = Math.round((height + 4) / (r.slit + 4));
            expect(m * (r.slit + 4) - 4).toBeCloseTo(height);
        }
    });

    it("never lets a cut cross the panel, which is the whole trick", () => {
        // Every slit runs along y; if any two in the same column joined up, or
        // one spanned the full width, the panel would be in pieces. What has to
        // hold is that no single cut touches both edges of the bend direction.
        for (const b of slits()) {
            expect(b.x1 - b.x0).toBeLessThan(BASE.width - 1);
        }
    });

    it("keeps every slit inside the panel", () => {
        const r = hinge();
        const b = ringBounds(r.rings);
        expect(b.x0).toBeGreaterThanOrEqual(-0.01);
        expect(b.y0).toBeGreaterThanOrEqual(-0.01);
        expect(b.x1).toBeLessThanOrEqual(r.width + 0.01);
        expect(b.y1).toBeLessThanOrEqual(r.height + 0.01);
    });

    it("staggers the links of neighbouring rows by half a period", () => {
        // The brick bond is the whole pattern, and what has to be staggered is
        // the *links* — the uncut bits. Line them all up at the same heights
        // and the panel folds along those lines instead of twisting evenly, and
        // tears there. Both columns still start a slit at the edge; the offset
        // one just starts a half-length slit, which is the bond, not a fault.
        const patch = { height: 80, link: 5, slit: 25 },
            r = hinge(patch),
            period = r.slit + 5;

        const byColumn = new Map<number, number[]>();
        for (const b of slits(patch)) {
            const x = Math.round(b.x0 * 100) / 100;
            // A link sits under every slit that does not run off the far edge.
            if (b.y1 < r.height - 0.01) byColumn.set(x, [...(byColumn.get(x) ?? []), b.y1]);
        }
        const columns = [...byColumn.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
        expect(columns.length).toBe(r.rows);

        for (let i = 1; i < columns.length; i++) {
            for (const y of columns[i]!) {
                const nearest = Math.min(...columns[i - 1]!.map(z => Math.abs(z - y)));
                expect(nearest, `column ${i} link at ${y}`).toBeCloseTo(period / 2, 1);
            }
        }
    });

    it("puts the pattern in a band when the ends have to stay flat", () => {
        const r = hinge({ flat: 20, width: 120 });
        const b = ringBounds(r.rings);
        expect(b.x0).toBeGreaterThanOrEqual(20);
        expect(b.x1).toBeLessThanOrEqual(100);
        // …and the panel is still the size it was asked for.
        expect(r.width).toBe(120);
    });

    it("leaves a border along the edges the slits run towards", () => {
        const r = hinge({ inset: 8, height: 80 });
        const b = ringBounds(r.rings);
        expect(b.y0).toBeGreaterThanOrEqual(8 - 0.01);
        expect(b.y1).toBeLessThanOrEqual(72 + 0.01);
    });

    it("turns the whole field on its side for a panel that rolls the other way", () => {
        const up = hinge({ bendAxis: "vertical", width: 120, height: 80 }),
            across = hinge({ bendAxis: "horizontal", width: 80, height: 120 });
        // The same panel, rotated: the same rows, the same pitch, and the slits
        // now running the other way.
        expect(across.rows).toBe(up.rows);
        expect(across.pitch).toBeCloseTo(up.pitch);
        const b = ringBounds(across.rings.slice(0, 1));
        expect(b.x1 - b.x0).toBeGreaterThan(b.y1 - b.y0);
    });
});

describe("the patterns", () => {
    it("cuts a straight slit as two points and a wave as many", () => {
        expect(hinge({ pattern: "straight" }).rings[0]!.length).toBe(2);
        expect(hinge({ pattern: "wave" }).rings[0]!.length).toBeGreaterThan(10);
    });

    it("keeps a wave inside its own row, so the rows cannot touch", () => {
        const r = hinge({ pattern: "wave", amplitude: 0.45, pitch: 5 });
        for (const b of slits({ pattern: "wave", amplitude: 0.45, pitch: 5 })) {
            // Half the pitch each way is the most a wave may wander; at 0.45 it
            // stays inside that with room to spare.
            expect(b.x1 - b.x0).toBeLessThan(5);
        }
    });

    it("adds a bar across the end of every slit that stops inside the panel", () => {
        const straight = hinge({ pattern: "straight" }).rings.length,
            tee = hinge({ pattern: "tee" }).rings.length;
        expect(tee).toBeGreaterThan(straight);
        // …but never on an end that runs off the edge, which would cut the
        // corner of the panel clean off.
        const r = hinge({ pattern: "tee" });
        const b = ringBounds(r.rings);
        expect(b.y0).toBeGreaterThanOrEqual(-0.01);
        expect(b.y1).toBeLessThanOrEqual(r.height + 0.01);
    });
});

describe("what it will actually do", () => {
    it("turns each row by the pitch over the radius, and nothing else", () => {
        // The one exact figure here: no material constant, no fudge.
        const r = hinge({ pitch: 5, radius: 40 });
        expect(r.twistPerRow).toBeCloseTo(5 / 40);
        expect(hinge({ pitch: 5, radius: 80 }).twistPerRow).toBeCloseTo(5 / 80);
    });

    it("takes the beam off both ends of every link", () => {
        expect(hinge({ link: 5, kerf: 0.2 }).effectiveLink).toBeCloseTo(4.8);
        expect(hinge({ link: 5, kerf: 0 }).effectiveLink).toBeCloseTo(5);
    });

    it("shears a link harder the thicker the sheet and the tighter the bend", () => {
        const thin = hinge({ thickness: 3 }).strain,
            thick = hinge({ thickness: 6 }).strain;
        expect(thick / thin).toBeCloseTo(2, 1);
        expect(hinge({ radius: 20 }).strain / hinge({ radius: 40 }).strain).toBeCloseTo(2, 1);
        // A longer link twists more gently over its length.
        expect(hinge({ link: 10 }).strain).toBeLessThan(hinge({ link: 5 }).strain);
    });

    it("reports the radius at which that strain is reached", () => {
        // The two figures have to agree: bend it to exactly minRadius and the
        // strain must land on the limit the warning uses.
        const r = hinge();
        const atLimit = hinge({ radius: r.minRadius });
        expect(atLimit.strain).toBeCloseTo(0.035, 3);
    });

    it("closing the rows up buys a tighter radius, proportionally", () => {
        expect(hinge({ pitch: 2.5 }).minRadius).toBeCloseTo(hinge({ pitch: 5 }).minRadius / 2, 1);
    });
});

describe("warnings", () => {
    const warns = (patch: Partial<HingeOptions>, re: RegExp): boolean =>
        hinge(patch).warnings.some(s => re.test(s));

    it("catches a link the beam has eaten", () => {
        expect(warns({ link: HINGE_LIMITS.minLink, kerf: 0.8 }, /falls into strips/)).toBe(true);
    });

    it("catches a link shorter than the sheet is thick", () => {
        expect(warns({ link: 1.5, thickness: 6, kerf: 0.1 }, /snaps instead of twisting/)).toBe(true);
        expect(warns({ link: 8, thickness: 3 }, /snaps instead of twisting/)).toBe(false);
    });

    it("catches a bend the links will not survive", () => {
        expect(warns({ radius: 5 }, /shear through every link/)).toBe(true);
        expect(warns({ radius: 400 }, /shear through every link/)).toBe(false);
    });

    it("catches too few rows to call it a curve", () => {
        expect(warns({ width: 20, pitch: 8 }, /fold at each row/)).toBe(true);
    });

    it("mentions the stiff border, because it is nearly always a mistake", () => {
        expect(warns({ inset: 6 }, /stiffer than everything/)).toBe(true);
        expect(warns({ inset: 0 }, /stiffer than everything/)).toBe(false);
    });
});

describe("the exports", () => {
    it("write the panel at true size in millimetres", () => {
        expect(hingeToSvg(hinge())).toContain('width="120mm"');
    });

    it("keep a slit open and the panel outline closed", () => {
        const src = hingeToDxf(hinge({ outline: true, pattern: "wave" })),
            closed = src.match(/\r\n90\r\n\d+\r\n70\r\n1\r\n/g) ?? [],
            open = src.match(/\r\n90\r\n\d+\r\n70\r\n0\r\n/g) ?? [];
        // Exactly one closed ring: the panel. A slit has no inside.
        expect(closed).toHaveLength(1);
        expect(open.length).toBeGreaterThan(50);
    });

    it("drops the outline when the panel is part of something else", () => {
        expect(hinge({ outline: false }).outline).toHaveLength(0);
        expect(hingeToDxf(hinge({ outline: false }))).not.toMatch(/\r\n90\r\n\d+\r\n70\r\n1\r\n/);
    });
});
