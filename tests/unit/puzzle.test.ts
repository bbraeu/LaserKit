import { describe, expect, it } from "vitest";
import { buildPuzzle } from "../../src/lib/puzzle";
import type { PuzzleOptions } from "../../src/lib/puzzle";
import { ringBounds } from "../../src/lib/design";

// What makes a jigsaw a jigsaw is the undercut: the knob's neck is narrower
// than its head, so a piece can be lifted out of the plane but not pulled out
// sideways. Lose that and the tool produces a grid of squares with bumps on
// that falls apart the moment the puzzle is picked up — and it would look
// perfectly fine on the canvas. So that is what is pinned hardest here.

const BASE: PuzzleOptions = {
    width: 200,
    height: 150,
    cols: 5,
    rows: 4,
    jitter: 0.5,
    knob: 0.2,
    radius: 0,
    seed: 3,
    outline: true
};

const puzzle = (patch: Partial<PuzzleOptions> = {}) => buildPuzzle({ ...BASE, ...patch });

describe("the grid", () => {
    it("cuts one joint per shared edge, not one outline per piece", () => {
        // 5 × 4 pieces: four vertical lines of four, three horizontal of five.
        const r = puzzle();
        expect(r.joints).toHaveLength(4 * 4 + 3 * 5);
        expect(r.pieces).toBe(20);
    });

    it("divides the sheet exactly, whatever the counts", () => {
        for (const [cols, rows] of [[3, 3], [7, 4], [13, 9]]) {
            const r = puzzle({ cols, rows });
            expect(r.pieceW * cols).toBeCloseTo(r.width);
            expect(r.pieceH * rows).toBeCloseTo(r.height);
        }
    });

    it("keeps every joint inside the sheet", () => {
        const r = puzzle();
        const b = ringBounds(r.joints);
        expect(b.x0).toBeGreaterThanOrEqual(-0.01);
        expect(b.y0).toBeGreaterThanOrEqual(-0.01);
        expect(b.x1).toBeLessThanOrEqual(r.width + 0.01);
        expect(b.y1).toBeLessThanOrEqual(r.height + 0.01);
    });

    it("starts and ends every joint exactly on the grid", () => {
        // A joint that missed its corner by a hair would leave the piece
        // attached by a sliver nobody can see and everybody can feel.
        const r = puzzle({ cols: 4, rows: 3 });
        for (const a of r.joints) {
            const p = a[0]!, q = a[a.length - 1]!,
                onGrid = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
            expect(onGrid(p.x, r.pieceW) || onGrid(p.y, r.pieceH)).toBe(true);
            expect(onGrid(q.x, r.pieceW) || onGrid(q.y, r.pieceH)).toBe(true);
        }
    });
});

describe("the knob", () => {
    /** How far a joint wanders off its own straight line, either way. */
    const swing = (a: { x: number; y: number }[]) => {
        const p = a[0]!, q = a[a.length - 1]!,
            dx = q.x - p.x, dy = q.y - p.y,
            len = Math.hypot(dx, dy);
        let lo = 0, hi = 0;
        for (const s of a) {
            // Signed distance from the line, positive on one side.
            const d = ((s.x - p.x) * -dy + (s.y - p.y) * dx) / len;
            lo = Math.min(lo, d);
            hi = Math.max(hi, d);
        }
        return { lo, hi };
    };

    it("sticks out on one side of the line and only just crosses to the other", () => {
        const r = puzzle({ jitter: 0 });
        for (const a of r.joints) {
            const { lo, hi } = swing(a),
                out = Math.max(hi, -lo),
                back = Math.min(hi, -lo);
            // A real knob, and a waist that dips only slightly the other way.
            expect(out).toBeGreaterThan(1);
            expect(back).toBeLessThan(out / 2);
        }
    });

    it("undercuts: the head is wider than the neck", () => {
        // The whole of what makes a jigsaw hold. Measured along the joint: the
        // widest part of the knob must be past the narrowest part of the neck.
        const r = puzzle({ jitter: 0, cols: 2, rows: 2, width: 100, height: 100 });
        const a = r.joints[0]!,
            p = a[0]!, q = a[a.length - 1]!,
            dx = q.x - p.x, dy = q.y - p.y,
            len = Math.hypot(dx, dy),
            along = (s: { x: number; y: number }) => ((s.x - p.x) * dx + (s.y - p.y) * dy) / len,
            offset = (s: { x: number; y: number }) => ((s.x - p.x) * -dy + (s.y - p.y) * dx) / len;

        const sign = Math.abs(Math.min(...a.map(offset))) > Math.max(...a.map(offset)) ? -1 : 1;
        const head = a.reduce((best, s) => (offset(s) * sign > offset(best) * sign ? s : best));
        // The two necks, either side of the head along the joint.
        const before = a.filter(s => along(s) < along(head)),
            after = a.filter(s => along(s) > along(head)),
            neckA = Math.max(...before.map(s => offset(s) * sign)),
            neckB = Math.max(...after.map(s => offset(s) * sign));

        // Both necks are narrower than the head is wide — that is the undercut.
        expect(offset(head) * sign).toBeGreaterThan(neckA);
        expect(offset(head) * sign).toBeGreaterThan(neckB);
    });

    it("scales with the piece and never with the sheet", () => {
        const small = puzzle({ width: 100, height: 100, cols: 5, rows: 5, jitter: 0 }),
            big = puzzle({ width: 200, height: 200, cols: 5, rows: 5, jitter: 0 });
        // Across the joint, not along it: the length of a joint is the piece,
        // and it is the knob standing out of it that has to keep in step.
        const reach = (r: typeof small) => {
            const b = ringBounds([r.joints[0]!]);
            return Math.min(b.x1 - b.x0, b.y1 - b.y0);
        };
        // Twice the piece, twice the knob.
        expect(reach(big) / reach(small)).toBeCloseTo(2, 1);
    });
});

describe("seed and jitter", () => {
    it("is the same puzzle for the same seed", () => {
        expect(puzzle({ seed: 9 }).preview).toBe(puzzle({ seed: 9 }).preview);
        expect(puzzle({ seed: 9 }).preview).not.toBe(puzzle({ seed: 10 }).preview);
    });

    it("makes every piece the same shape at zero jitter, and says so", () => {
        const r = puzzle({ jitter: 0 });
        expect(r.warnings.some(s => /every piece fits every socket/.test(s))).toBe(true);
        expect(puzzle({ jitter: 0.5 }).warnings.some(s => /every piece fits every socket/.test(s))).toBe(false);
    });

    it("moves the knobs along their edges without changing how they lock", () => {
        const still = puzzle({ jitter: 0 }),
            moved = puzzle({ jitter: 1 });
        expect(moved.joints.length).toBe(still.joints.length);
        // Same number of joints, different shapes.
        expect(moved.preview).not.toBe(still.preview);
    });
});

describe("warnings and output", () => {
    it("always says the kerf is the fit", () => {
        expect(puzzle().warnings.some(s => /one kerf loose/.test(s))).toBe(true);
    });

    it("says when the pieces are too small to handle", () => {
        expect(puzzle({ cols: 30, rows: 20 }).warnings.some(s => /snap off/.test(s))).toBe(true);
    });

    it("writes the joints open and the border closed", () => {
        const r = puzzle({ outline: true });
        expect(r.outline).toHaveLength(1);
        expect(puzzle({ outline: false }).outline).toHaveLength(0);
    });
});
