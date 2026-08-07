import { describe, expect, it } from "vitest";
import { ringCentre } from "../../src/lib/text";
import type { TextOptions } from "../../src/lib/text";
import { cssFamily, isFontFile } from "../../src/lib/fonts";

// The text generator's geometry needs a canvas to set type on, so almost all of
// it is an end-to-end test. What is pure — where the keyring hole lands, and
// how a family name reaches the CSS font shorthand — is here.

const opts = (o: Partial<TextOptions>): TextOptions => ({
    text: "A", fontFamily: "sans-serif", bold: false, italic: false,
    capHeight: 20, letterSpacing: 0, wordSpacing: 0, lineHeight: 1.4, align: "left",
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
