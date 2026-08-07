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
    difficulty: 0.5,
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

    it("starts and ends every joint exactly on the grid, at difficulty 0", () => {
        // A joint that missed its corner by a hair would leave the piece
        // attached by a sliver nobody can see and everybody can feel. Above 0
        // the corners deliberately wander, and that they still *meet* is
        // checked under difficulty below.
        const r = puzzle({ cols: 4, rows: 3, difficulty: 0 });
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
        const r = puzzle({ difficulty: 0 });
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
        const r = puzzle({ difficulty: 0, cols: 2, rows: 2, width: 100, height: 100 });
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
        const small = puzzle({ width: 100, height: 100, cols: 5, rows: 5, difficulty: 0 }),
            big = puzzle({ width: 200, height: 200, cols: 5, rows: 5, difficulty: 0 });
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

describe("seed and difficulty", () => {
    it("is the same puzzle for the same seed", () => {
        expect(puzzle({ seed: 9 }).preview).toBe(puzzle({ seed: 9 }).preview);
        expect(puzzle({ seed: 9 }).preview).not.toBe(puzzle({ seed: 10 }).preview);
    });

    it("makes every piece the same shape at zero difficulty, and says so", () => {
        const r = puzzle({ difficulty: 0 });
        expect(r.warnings.some(s => /every piece fits every socket/.test(s))).toBe(true);
        expect(puzzle({ difficulty: 0.5 }).warnings.some(s => /every piece fits every socket/.test(s))).toBe(false);
    });

    it("makes the pieces different sizes as it gets harder", () => {
        // The biggest thing difficulty does, and the thing the old jitter did
        // not do at all: at 0 every cell is identical, and by 1 they are not.
        expect(puzzle({ difficulty: 0 }).spread).toBeCloseTo(1);
        // Averaged over seeds, because one seed's spread is one roll of the
        // dice: what has to hold is that the slider means something, not that
        // any particular puzzle lands on a number.
        const mean = (difficulty: number) =>
            [1, 2, 3, 4, 5].reduce((n, seed) => n + puzzle({ difficulty, seed }).spread, 0) / 5;
        expect(mean(0.5)).toBeGreaterThan(1.3);
        expect(mean(1)).toBeGreaterThan(mean(0.5) * 1.2);
    });

    it("still meets at every corner however far they have wandered", () => {
        // Two joints share a lattice corner. If they read it separately the
        // pieces would be joined by a sliver, or not at all.
        const r = puzzle({ difficulty: 1, cols: 4, rows: 3 });
        const ends = r.joints.flatMap(a => [a[0]!, a[a.length - 1]!]);
        for (const e of ends) {
            // Every joint end is shared with another joint's end, or sits on
            // the border.
            const shared = ends.filter(o => Math.hypot(o.x - e.x, o.y - e.y) < 1e-6).length,
                onEdge = e.x < 1e-6 || e.y < 1e-6
                    || Math.abs(e.x - r.width) < 1e-6 || Math.abs(e.y - r.height) < 1e-6;
            expect(shared > 1 || onEdge, `end at ${e.x},${e.y}`).toBe(true);
        }
    });

    it("keeps the knobs off each other when a corner has wandered close", () => {
        // A knob is capped to a share of its own edge, so a short edge gets a
        // small knob rather than one that swallows the piece beside it.
        const r = puzzle({ difficulty: 1, cols: 8, rows: 6 });
        for (const a of r.joints) {
            const p0 = a[0]!, q = a[a.length - 1]!,
                len = Math.hypot(q.x - p0.x, q.y - p0.y),
                dx = (q.x - p0.x) / len, dy = (q.y - p0.y) / len,
                reach = Math.max(...a.map(s => Math.abs((s.x - p0.x) * -dy + (s.y - p0.y) * dx)));
            expect(reach).toBeLessThanOrEqual(len * 0.43);
        }
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
