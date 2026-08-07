import { describe, expect, it } from "vitest";
import { formatMm, gridSteps, niceStep, rulerSteps } from "../../src/workspace/rulers";

// The rulers and the grid are the app's claim that what you see is millimetres.
// If the step ladder ever produces 3 mm or 7 mm squares that claim is broken —
// you cannot count in sevens off a screen — so the ladder itself is the test.

describe("niceStep", () => {
    it("only ever returns a 1-2-5 decade", () => {
        for (let pxPerMm = 0.05; pxPerMm < 400; pxPerMm *= 1.17) {
            const step = niceStep(9, pxPerMm),
                mantissa = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
            expect([1, 2, 5, 10]).toContain(Math.round(mantissa * 1000) / 1000);
        }
    });

    it("never draws a step tighter than asked for", () => {
        for (let pxPerMm = 0.1; pxPerMm < 200; pxPerMm *= 1.3) {
            expect(niceStep(9, pxPerMm) * pxPerMm).toBeGreaterThanOrEqual(9 - 1e-9);
        }
    });

    it("picks the smallest step that clears the minimum", () => {
        // 10 px/mm: 1 mm is 10 px, which already clears 9 px.
        expect(niceStep(9, 10)).toBe(1);
        // 1 px/mm: 1 mm is 1 px, 2 is 2, 5 is 5, 10 is 10 — the first that fits.
        expect(niceStep(9, 1)).toBe(10);
        // 4 px/mm: 2 mm is 8 px (too tight), 5 mm is 20 px.
        expect(niceStep(9, 4)).toBe(5);
    });

    it("survives a degenerate zoom rather than dividing by zero", () => {
        expect(niceStep(9, 0)).toBe(1);
        expect(niceStep(9, Number.POSITIVE_INFINITY)).toBe(1);
        expect(niceStep(9, Number.NaN)).toBe(1);
    });
});

describe("gridSteps", () => {
    it("draws a heavier line every five squares", () => {
        const { minor, major } = gridSteps(12);
        expect(major).toBe(minor * 5);
    });
});

describe("rulerSteps", () => {
    it("labels a step wide enough to hold its own number", () => {
        const { major } = rulerSteps(20);
        expect(major * 20).toBeGreaterThanOrEqual(64);
    });

    it("puts four unlabelled ticks between the labelled ones", () => {
        const { minor, major } = rulerSteps(20);
        expect(major / minor).toBe(5);
    });
});

describe("formatMm", () => {
    it("writes whole millimetres without a decimal point", () => {
        expect(formatMm(10)).toBe("10");
        expect(formatMm(0)).toBe("0");
    });

    it("keeps a half-millimetre tick readable", () => {
        expect(formatMm(12.5)).toBe("12.5");
    });

    it("does not print floating-point noise", () => {
        expect(formatMm(0.1 + 0.2)).toBe("0.3");
    });
});
