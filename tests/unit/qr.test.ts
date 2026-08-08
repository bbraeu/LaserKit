import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import { buildQr, qrToDxf, qrToSvg } from "../../src/lib/qr";
import type { QrOptions } from "../../src/lib/qr";
import { ringBounds } from "../../src/lib/design";
import { OPERATION_COLORS } from "../../src/lib/dxf";

// The encoding is `qrcode-generator`'s and is not tested here: a QR code that
// is wrong looks exactly like one that is right, and nothing in this repository
// can decode one to tell. What *is* tested is everything this file does with
// the module matrix — because a code that encodes perfectly and is then drawn
// half a module out, or merged into rectangles that do not cover the same
// squares, is just as unscannable and is entirely our fault.

const BASE: QrOptions = {
    text: "https://bbraeu.github.io/LaserKit/",
    ecc: "M",
    mode: "engrave",
    size: 60,
    quiet: 4,
    trim: 0,
    outline: true,
    radius: 0
};

const qr = (patch: Partial<QrOptions> = {}) => buildQr({ ...BASE, ...patch });

/** The matrix the encoder produced, read independently of the tool. */
const matrix = (text: string, ecc: "L" | "M" | "Q" | "H" = "M") => {
    const q = qrcode(0, ecc);
    q.addData(text);
    q.make();
    return q;
};

describe("what the code says about itself", () => {
    it("reports the version the module count implies", () => {
        const r = qr();
        expect(r.modules).toBe(4 * r.version + 17);
    });

    it("grows a version as the data grows", () => {
        const small = qr({ text: "hi" }),
            big = qr({ text: "x".repeat(300) });
        expect(big.version).toBeGreaterThan(small.version);
    });

    it("grows a version as the error correction goes up", () => {
        const low = qr({ text: "x".repeat(100), ecc: "L" }),
            high = qr({ text: "x".repeat(100), ecc: "H" });
        expect(high.version).toBeGreaterThan(low.version);
    });

    it("refuses more than a code can hold, rather than drawing a lie", () => {
        // A version 40 holds 2 953 bytes at the lowest error correction and
        // 1 273 at the highest, so this fits one way round and not the other.
        expect(() => qr({ text: "x".repeat(2000), ecc: "L" })).not.toThrow();
        expect(() => qr({ text: "x".repeat(2000), ecc: "H" })).toThrow(/too much data/);
    });

    it("will not draw an empty code", () => {
        expect(() => qr({ text: "   " })).toThrow(/Type something/);
    });
});

describe("modules to geometry", () => {
    it("covers exactly the dark modules, and nothing else", () => {
        // The heart of it. Every dark module's centre must be inside some
        // rectangle, and every light module's centre must be inside none — a
        // merge that ran one square too far is a code that does not scan and
        // looks perfect.
        const r = qr({ text: "LASERKIT", quiet: 4, size: 60 }),
            q = matrix("LASERKIT"),
            m = r.moduleSize,
            aRect = r.aLayer.find(l => l.filled)!.rings.map(a => ringBounds([a]));

        const covered = (x: number, y: number) =>
            aRect.some(b => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);

        for (let row = 0; row < r.modules; row++) {
            for (let col = 0; col < r.modules; col++) {
                const x = (4 + col + 0.5) * m,
                    y = (4 + row + 0.5) * m;
                expect(covered(x, y), `module ${row},${col}`).toBe(q.isDark(row, col));
            }
        }
    });

    it("merges runs along a row into one rectangle each", () => {
        const r = qr();
        // Far fewer rectangles than dark modules, and never more.
        expect(r.rects).toBeLessThan(r.dark * 0.6);
        expect(r.rects).toBeGreaterThan(0);
    });

    it("puts the quiet border where it was asked for", () => {
        const r = qr({ quiet: 4, size: 60 }),
            b = ringBounds(r.aLayer.find(l => l.filled)!.rings);
        // Nothing dark is inside the border…
        expect(b.x0).toBeGreaterThanOrEqual(4 * r.moduleSize - 0.001);
        expect(b.y0).toBeGreaterThanOrEqual(4 * r.moduleSize - 0.001);
        // …and the code plus two borders is the size that was asked for.
        expect((r.modules + 8) * r.moduleSize).toBeCloseTo(60);
    });

    it("keeps the whole code inside the plate", () => {
        const r = qr();
        const b = ringBounds(r.aLayer.flatMap(l => l.rings));
        expect(b.x0).toBeGreaterThanOrEqual(-0.01);
        expect(b.y0).toBeGreaterThanOrEqual(-0.01);
        expect(b.x1).toBeLessThanOrEqual(r.width + 0.01);
        expect(b.y1).toBeLessThanOrEqual(r.height + 0.01);
    });

    it("comes out the size asked for whatever the version", () => {
        for (const text of ["hi", "https://example.com/a/fairly/long/path", "x".repeat(200)]) {
            expect(qr({ text, size: 80 }).width).toBe(80);
        }
    });

    it("shrinks every tile by the trim, on every side", () => {
        const plain = qr({ trim: 0, mode: "inlay" }),
            trimmed = qr({ trim: 0.2, mode: "inlay" }),
            first = (r: typeof plain) => ringBounds([r.aLayer.find(l => !l.filled && l.rings.length > 1)!.rings[0]!]);
        const a = first(plain), b = first(trimmed);
        expect(b.y1 - b.y0).toBeCloseTo(a.y1 - a.y0 - 0.4);
    });
});

describe("engraving and inlay", () => {
    it("engraves as filled area and inlays as cut line", () => {
        expect(qr({ mode: "engrave" }).aLayer.some(l => l.filled)).toBe(true);
        expect(qr({ mode: "inlay" }).aLayer.every(l => !l.filled)).toBe(true);
    });

    it("says how many loose pieces an inlay makes", () => {
        const r = qr({ mode: "inlay" });
        expect(r.warnings.some(s => new RegExp(`${r.rects} dark pieces`).test(s))).toBe(true);
    });

    it("uses the engraving colour for a fill and the cut colour for tiles", () => {
        expect(qrToDxf(qr({ mode: "engrave" })))
            .toContain(`\r\n62\r\n${OPERATION_COLORS.FILL_VECTOR_ENGRAVING!.color}\r\n`);
        expect(qrToDxf(qr({ mode: "inlay", outline: false })))
            .not.toContain(`\r\n62\r\n${OPERATION_COLORS.FILL_VECTOR_ENGRAVING!.color}\r\n`);
    });
});

describe("warnings", () => {
    const warns = (patch: Partial<QrOptions>, re: RegExp) => qr(patch).warnings.some(s => re.test(s));

    it("catches modules too small for a beam", () => {
        expect(warns({ size: 15, text: "x".repeat(120) }, /stops scanning/)).toBe(true);
        expect(warns({ size: 120, text: "hi" }, /stops scanning/)).toBe(false);
    });

    it("catches a missing quiet border", () => {
        expect(warns({ quiet: 0 }, /quiet border of four/)).toBe(true);
        expect(warns({ quiet: 4 }, /quiet border of four/)).toBe(false);
    });

    it("says trim belongs to cutting, not engraving", () => {
        expect(warns({ trim: 0.1, mode: "engrave" }, /Trim is for cutting/)).toBe(true);
        expect(warns({ trim: 0.1, mode: "inlay" }, /Trim is for cutting/)).toBe(false);
    });

    it("suggests a shorter link before a denser code", () => {
        expect(warns({ text: "https://example.com/" + "x".repeat(220) }, /link shortener/)).toBe(true);
    });
});

describe("the exports", () => {
    it("write the plate at true size in millimetres", () => {
        expect(qrToSvg(qr({ size: 45 }))).toContain('width="45mm"');
    });

    it("drop the plate when it is not being cut", () => {
        const r = qr({ outline: false });
        expect(r.aLayer).toHaveLength(1);
    });
});

describe("the quiet border, now that it is not a control", () => {
    it("still complains about a code that arrives with too little of one", () => {
        // The slider is gone: the specification asks for four modules, every
        // value below four made the tool complain and every value above four
        // only wasted material, so its single correct position was its default.
        // The check stays, because a link somebody bookmarked before that
        // change still carries whatever they had set — and a code that will not
        // scan should say so rather than look fine.
        expect(qr({ quiet: 0 }).warnings.some(s => /quiet border of four/.test(s))).toBe(true);
        expect(qr({ quiet: 4 }).warnings.some(s => /quiet border of four/.test(s))).toBe(false);
    });
});
