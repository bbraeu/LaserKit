import { describe, expect, it } from "vitest";
import { arcPoint, ringCentre } from "../../src/lib/text";
import type { TextOptions } from "../../src/lib/text";
import { cssFamily, isFontFile } from "../../src/lib/fonts";

// The text generator's geometry needs a canvas to set type on, so almost all of
// it is an end-to-end test. What is pure — where the keyring hole lands, and
// how a family name reaches the CSS font shorthand — is here.

const opts = (o: Partial<TextOptions>): TextOptions => ({
    text: "A", fontFamily: "sans-serif", bold: false, italic: false,
    capHeight: 20, letterSpacing: 0, wordSpacing: 0, lineHeight: 1.4, align: "left",
    shape: "straight", arcRadius: 40, arcSide: "top",
    smooth: 1, simplify: 0.4,
    plate: true, border: 2, connect: true, connectMode: "wrap", reach: 0,
    letters: "engrave",
    ring: true, ringDiameter: 4, ringEdge: "left", ringOffset: 50, ringInset: 5, ringWall: 2.5,
    ...o
});

/** A 100 × 40 mm plate with its origin away from 0,0, so offsets cannot fake it. */
const BOX = { x0: 10, y0: 20, x1: 110, y1: 60 };

describe("ringCentre", () => {
    it("hangs the hole off the edge that was picked", () => {
        expect(ringCentre(BOX, opts({ ringEdge: "left" }))).toEqual({ x: 15, y: 40 });
        expect(ringCentre(BOX, opts({ ringEdge: "right" }))).toEqual({ x: 105, y: 40 });
        expect(ringCentre(BOX, opts({ ringEdge: "top" }))).toEqual({ x: 60, y: 25 });
        expect(ringCentre(BOX, opts({ ringEdge: "bottom" }))).toEqual({ x: 60, y: 55 });
    });

    it("slides it along that edge, 0 % to 100 %", () => {
        expect(ringCentre(BOX, opts({ ringEdge: "top", ringOffset: 0 })).x).toBe(10);
        expect(ringCentre(BOX, opts({ ringEdge: "top", ringOffset: 100 })).x).toBe(110);
        expect(ringCentre(BOX, opts({ ringEdge: "top", ringOffset: 25 })).x).toBe(35);
        // The offset runs along the edge, so it never moves the other axis.
        expect(ringCentre(BOX, opts({ ringEdge: "top", ringOffset: 25 })).y).toBe(25);
    });

    it("measures the inset inwards from that edge, whichever it is", () => {
        expect(ringCentre(BOX, opts({ ringEdge: "left", ringInset: 12 })).x).toBe(22);
        expect(ringCentre(BOX, opts({ ringEdge: "right", ringInset: 12 })).x).toBe(98);
        expect(ringCentre(BOX, opts({ ringEdge: "bottom", ringInset: 12 })).y).toBe(48);
    });

    it("clamps a nonsense offset rather than placing the hole off the plate", () => {
        expect(ringCentre(BOX, opts({ ringEdge: "top", ringOffset: -50 })).x).toBe(10);
        expect(ringCentre(BOX, opts({ ringEdge: "top", ringOffset: 500 })).x).toBe(110);
    });
});

describe("arcPoint", () => {
    const O = { x: 0, y: 0 },
        R = 40,
        /** Distance from the circle's centre — what "on the baseline" means. */
        reach = (p: { x: number; y: number }) => Math.hypot(p.x - O.x, p.y - O.y);

    it("stands the crown of the arc straight above the centre, and below it upside down", () => {
        // y grows downward, so "above" is negative.
        expect(arcPoint(0, 0, 0, R, "top", O)).toEqual({ x: 0, y: -40 });
        expect(arcPoint(0, 0, 0, R, "bottom", O)).toEqual({ x: 0, y: 40 });
    });

    it("keeps every point of a letter on the baseline circle", () => {
        for (const s of [-30, -10, 0, 7, 25]) {
            expect(reach(arcPoint(s, 0, 0, R, "top", O))).toBeCloseTo(R);
            expect(reach(arcPoint(s, 0, 0, R, "bottom", O))).toBeCloseTo(R);
        }
    });

    it("measures along the arc, not across the chord", () => {
        // A letter 20 mm along the baseline sits 20 mm of *arc* from the crown,
        // which is what makes the letter spacing survive the bend.
        const a = arcPoint(0, 0, 0, R, "top", O),
            b = arcPoint(20, 0, 0, R, "top", O),
            angle = Math.atan2(b.x - O.x, -(b.y - O.y)) - Math.atan2(a.x - O.x, -(a.y - O.y));
        expect(angle * R).toBeCloseTo(20);
    });

    it("puts a letter's height outside the circle on top and inside it below", () => {
        // dy is negative above the baseline, exactly as the glyph was traced.
        expect(reach(arcPoint(12, -8, 0, R, "top", O))).toBeCloseTo(R + 8);
        expect(reach(arcPoint(12, -8, 0, R, "bottom", O))).toBeCloseTo(R - 8);
        // …and a descender goes the other way in both cases.
        expect(reach(arcPoint(12, 3, 0, R, "top", O))).toBeCloseTo(R - 3);
        expect(reach(arcPoint(12, 3, 0, R, "bottom", O))).toBeCloseTo(R + 3);
    });

    it("turns the letter to face its own point on the circle", () => {
        // A letter's own up-vector must point away from the centre on a top arc.
        const s = 25,
            foot = arcPoint(s, 0, 0, R, "top", O),
            head = arcPoint(s, -10, 0, R, "top", O),
            radial = { x: foot.x - O.x, y: foot.y - O.y },
            up = { x: head.x - foot.x, y: head.y - foot.y },
            cos = (up.x * radial.x + up.y * radial.y) / (Math.hypot(up.x, up.y) * Math.hypot(radial.x, radial.y));
        expect(cos).toBeCloseTo(1);
    });

    it("keeps a letter rigid — the same shape, only moved and turned", () => {
        // Two points of one glyph stay exactly as far apart as they were, which
        // is the whole difference between setting type on a curve and warping it.
        const s = 18,
            a = arcPoint(s, -14, -3, R, "top", O),
            b = arcPoint(s, 0, 2.5, R, "top", O);
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.hypot(2.5 - -3, 0 - -14));
    });

    it("reads left to right on both halves of a badge", () => {
        const leftTop = arcPoint(-20, 0, 0, R, "top", O),
            rightTop = arcPoint(20, 0, 0, R, "top", O),
            leftBottom = arcPoint(-20, 0, 0, R, "bottom", O),
            rightBottom = arcPoint(20, 0, 0, R, "bottom", O);
        expect(rightTop.x).toBeGreaterThan(leftTop.x);
        expect(rightBottom.x).toBeGreaterThan(leftBottom.x);
    });

    it("is a straight baseline in the limit of a huge radius", () => {
        // The one property that makes the control continuous: dragging the
        // radius up must not make the text jump somewhere else.
        const p = arcPoint(15, -6, 0, 1e6, "top", O);
        expect(p.x).toBeCloseTo(15, 3);
        expect(p.y + 1e6).toBeCloseTo(-6, 3);
    });
});

describe("cssFamily", () => {
    it("leaves the generic keywords bare — quoting them would break them", () => {
        for (const s of ["sans-serif", "serif", "monospace", "cursive", "fantasy"]) {
            expect(cssFamily(s)).toBe(s);
        }
    });

    it("quotes a real family, so a name with a space is one name", () => {
        expect(cssFamily("Times New Roman")).toBe('"Times New Roman"');
    });

    it("escapes a quote in the name rather than ending the string early", () => {
        expect(cssFamily('Ba"d')).toBe('"Ba\\"d"');
    });
});

describe("isFontFile", () => {
    const f = (name: string) => new File([""], name);

    it("takes the four the browser can register", () => {
        for (const n of ["a.ttf", "a.otf", "a.woff", "a.woff2", "A.TTF"]) {
            expect(isFontFile(f(n))).toBe(true);
        }
    });

    it("turns everything else away", () => {
        for (const n of ["a.svg", "a.png", "a.xcs", "fonts", "a.ttf.png"]) {
            expect(isFontFile(f(n))).toBe(false);
        }
    });
});
