import { describe, expect, it } from "vitest";
import { buildNest, nestToDxf } from "../../src/lib/nest";
import type { NestOptions } from "../../src/lib/nest";
import type { DesignDoc } from "../../src/lib/design";
import { subBounds } from "../../src/lib/design";
import { OPERATION_COLORS } from "../../src/lib/dxf";
import type { Subpath } from "../../src/lib/dxf";
import { shelfPack } from "../../src/lib/design";

// Nesting is arithmetic about rectangles, so almost all of it can be checked
// here. The two things worth pinning hardest are the ones a glance at the
// canvas cannot check: that nothing has been placed outside the sheet, and that
// an engraved line has not quietly become a cut one.

const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const ENGRAVE = OPERATION_COLORS.FILL_VECTOR_ENGRAVING!;

/** A design `w × h` with an engraved line inside a cut outline. */
const design = (w: number, h: number, bOps = true): DesignDoc => {
    const aSub: Subpath[] = [
        {
            closed: true,
            operation: bOps ? CUT : undefined,
            points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
        },
        {
            closed: false,
            operation: bOps ? ENGRAVE : undefined,
            points: [{ x: w * 0.25, y: h / 2 }, { x: w * 0.75, y: h / 2 }]
        }
    ];
    return { title: "Design", aSub, width: w, height: h, assumed: false, warnings: [] };
};

const BASE: NestOptions = {
    mode: "fill",
    copies: 10,
    sheetWidth: 400,
    sheetHeight: 300,
    gap: 2,
    margin: 5,
    rotate: false
};

const nest = (doc: DesignDoc, patch: Partial<NestOptions> = {}) => buildNest(doc, { ...BASE, ...patch });

/** Every point of every copy, whatever operation it is on. */
const allPoints = (r: ReturnType<typeof nest>) =>
    r.aLayer.flatMap(l => l.subpaths.flatMap(sub => sub.points));

describe("how many fit", () => {
    it("fills the sheet in rows and columns", () => {
        // 390 of field for 50-wide copies at a 2 mm gap: (390+2)/52 = 7 across.
        // 290 of field for 30-tall copies: (290+2)/32 = 9 down.
        const r = nest(design(50, 30));
        expect(r.columns).toBe(7);
        expect(r.rows).toBe(9);
        expect(r.perSheet).toBe(63);
        expect(r.placed).toBe(63);
    });

    it("counts the gaps between copies and not after the last one", () => {
        // Exactly four 100 mm copies with 0 gap in a 400 mm field.
        const r = nest(design(100, 100), { margin: 0, gap: 0, sheetWidth: 400, sheetHeight: 100 });
        expect(r.columns).toBe(4);
        // One millimetre of gap and the fourth no longer fits.
        expect(nest(design(100, 100), { margin: 0, gap: 1, sheetWidth: 400, sheetHeight: 100 }).columns).toBe(3);
    });

    it("takes the margin off both edges, not one", () => {
        const none = nest(design(50, 30), { margin: 0 }),
            some = nest(design(50, 30), { margin: 25 });
        expect(some.columns).toBeLessThan(none.columns);
        // 400 − 50 = 350 of field, so (350+2)/52 = 6 across.
        expect(some.columns).toBe(6);
    });

    it("lays only what was asked for when a number was asked for", () => {
        expect(nest(design(50, 30), { mode: "count", copies: 12 }).placed).toBe(12);
        expect(nest(design(50, 30), { mode: "fill", copies: 12 }).placed).toBe(63);
    });

    it("works out how many sheets a run needs", () => {
        const r = nest(design(50, 30), { mode: "count", copies: 100 });
        expect(r.perSheet).toBe(63);
        expect(r.sheets).toBe(2);
    });
});

describe("turning the design", () => {
    it("lays it on its side when that fits more", () => {
        // 40 × 30 on a 100 × 50 sheet. Standing up: two across, one down.
        // Turned: three across, still one down. Turning is not usually worth
        // anything — the counts are symmetric until the truncation bites, which
        // is exactly the case worth having the switch for.
        const opt = { sheetWidth: 100, sheetHeight: 50, margin: 0, gap: 0 };
        const up = nest(design(40, 30), { ...opt, rotate: false }),
            turn = nest(design(40, 30), { ...opt, rotate: true });
        expect(up.perSheet).toBe(2);
        expect(turn.turned).toBe(true);
        expect(turn.perSheet).toBe(3);
        // Turned means the box's sides have swapped.
        expect(turn.itemW).toBeCloseTo(30);
        expect(turn.itemH).toBeCloseTo(40);
    });

    it("leaves it alone when turning buys nothing", () => {
        const r = nest(design(50, 30), { rotate: true });
        expect(r.turned).toBe(false);
    });

    it("turns every copy or none, never a mixture", () => {
        // Same shape every time, so a mixture packs no tighter and only makes
        // the grain run two ways.
        const r = nest(design(90, 40), { rotate: true, sheetWidth: 100, sheetHeight: 400, margin: 0 });
        const w = new Set(r.aLayer.flatMap(l => l.subpaths
            .filter(s => s.closed)
            .map(s => Math.round((subBounds([s]).x1 - subBounds([s]).x0) * 100) / 100)));
        expect(w.size).toBe(1);
    });
});

describe("where the copies land", () => {
    it("keeps every copy inside the sheet", () => {
        const r = nest(design(50, 30)),
            a = allPoints(r);
        expect(Math.min(...a.map(p => p.x))).toBeGreaterThanOrEqual(-0.01);
        expect(Math.min(...a.map(p => p.y))).toBeGreaterThanOrEqual(-0.01);
        expect(Math.max(...a.map(p => p.x))).toBeLessThanOrEqual(r.width + 0.01);
        expect(Math.max(...a.map(p => p.y))).toBeLessThanOrEqual(r.height + 0.01);
    });

    it("keeps them inside the margin as well, which is the point of it", () => {
        const r = nest(design(50, 30), { margin: 20 }),
            a = allPoints(r);
        expect(Math.min(...a.map(p => p.x))).toBeGreaterThanOrEqual(20 - 0.01);
        expect(Math.min(...a.map(p => p.y))).toBeGreaterThanOrEqual(20 - 0.01);
        expect(Math.max(...a.map(p => p.x))).toBeLessThanOrEqual(r.width - 20 + 0.01);
    });

    it("never lets two copies touch", () => {
        const r = nest(design(50, 30), { gap: 4 }),
            aBox = r.aLayer.flatMap(l => l.subpaths.filter(s => s.closed).map(s => subBounds([s])));
        expect(aBox.length).toBe(r.placed);
        for (let i = 0; i < aBox.length; i++) {
            for (let j = i + 1; j < aBox.length; j++) {
                const a = aBox[i]!, b = aBox[j]!,
                    apart = a.x1 <= b.x0 + 1e-6 || b.x1 <= a.x0 + 1e-6
                        || a.y1 <= b.y0 + 1e-6 || b.y1 <= a.y0 + 1e-6;
                expect(apart, `copies ${i} and ${j} overlap`).toBe(true);
            }
        }
    });

    it("moves a copy and does not reshape it", () => {
        const r = nest(design(50, 30), { mode: "count", copies: 2 }),
            aCut = r.aLayer.find(l => l.operation === CUT)!.subpaths;
        const size = (s: Subpath) => {
            const b = subBounds([s]);
            return [b.x1 - b.x0, b.y1 - b.y0];
        };
        expect(size(aCut[0]!)).toEqual(size(aCut[1]!));
    });
});

describe("the operations", () => {
    it("keeps engraving engraving and cutting cutting", () => {
        // The whole reason to have this tool rather than copy-paste in a laser
        // program: twenty copies of a keychain whose lettering became a cut
        // line is twenty ruined blanks, and nothing on the canvas says so.
        const r = nest(design(50, 30), { mode: "count", copies: 6 });
        expect(r.aLayer).toHaveLength(2);
        const cut = r.aLayer.find(l => l.operation === CUT)!,
            eng = r.aLayer.find(l => l.operation === ENGRAVE)!;
        expect(cut.subpaths).toHaveLength(6);
        expect(eng.subpaths).toHaveLength(6);
        expect(eng.subpaths.every(s => !s.closed)).toBe(true);
    });

    it("carries the colours into the DXF, which is how software groups a job", () => {
        const src = nestToDxf(nest(design(50, 30), { mode: "count", copies: 2 }));
        expect(src).toContain(`\r\n62\r\n${CUT.color}\r\n`);
        expect(src).toContain(`\r\n62\r\n${ENGRAVE.color}\r\n`);
    });

    it("says so when the design's colours mean nothing", () => {
        const r = nest(design(50, 30, false), { mode: "count", copies: 2 });
        expect(r.aLayer).toHaveLength(1);
        expect(r.warnings.some(s => /one unnamed operation/.test(s))).toBe(true);
    });
});

describe("warnings", () => {
    it("says when not even one copy fits", () => {
        const r = nest(design(500, 400));
        expect(r.perSheet).toBe(0);
        expect(r.placed).toBe(0);
        expect(r.warnings.some(s => /not one copy fits/.test(s))).toBe(true);
    });

    it("says when the run needs more than the sheet holds", () => {
        expect(nest(design(50, 30), { mode: "count", copies: 100 }).warnings
            .some(s => /do not fit on one sheet/.test(s))).toBe(true);
    });

    it("says when the copies touch", () => {
        expect(nest(design(50, 30), { gap: 0 }).warnings
            .some(s => /same slot twice/.test(s))).toBe(true);
    });

    it("passes the design's own complaints on", () => {
        const doc = design(50, 30);
        doc.warnings.push("This SVG stated no size.");
        expect(nest(doc).warnings).toContain("This SVG stated no size.");
    });
});

describe("shelf packing", () => {
    it("fills a row before starting the next", () => {
        const { aPlaced, width, height } = shelfPack(
            Array.from({ length: 6 }, () => ({ w: 30, h: 20 })), 100, 0);
        // Three across at 30 in 100, then down.
        expect(aPlaced.slice(0, 3).map(p => p.y)).toEqual([0, 0, 0]);
        expect(aPlaced[3]!.y).toBe(20);
        expect(width).toBe(90);
        expect(height).toBe(40);
    });

    it("widens the sheet rather than dropping a part too big for it", () => {
        const r = shelfPack([{ w: 300, h: 10 }, { w: 20, h: 10 }], 100, 0);
        expect(r.over).toBe(1);
        expect(r.aPlaced).toHaveLength(2);
        // The row widens to hold the part that did not fit, and the next part
        // starts a row of its own rather than being tucked in beside it.
        expect(r.width).toBe(300);
        expect(r.aPlaced[1]).toMatchObject({ x: 0, y: 10 });
    });

    it("leaves the row height to the tallest thing in it", () => {
        const r = shelfPack([{ w: 30, h: 50 }, { w: 30, h: 10 }, { w: 30, h: 10 }, { w: 30, h: 10 }], 100, 0);
        expect(r.aPlaced[3]!.y).toBe(50);
    });
});
