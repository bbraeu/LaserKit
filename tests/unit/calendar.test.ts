import { describe, expect, it } from "vitest";
import {
    buildCalendar, cellOf, daysInMonth, firstColumn, holderOptions, isLeap, layoutSheets, monthLines, monthText
} from "../../src/lib/calendar";
import type { CalendarOptions } from "../../src/lib/calendar";

// A calendar is the one thing in this kit where being wrong is invisible and
// total: a plaque with the 29th of February 2027 on it is firewood, and nothing
// about the drawing says so. So the dates are checked against known days rather
// than against the code that produced them.

const BASE: CalendarOptions = {
    year: 2026,
    month: null,
    weekStart: "monday",
    language: "en",
    columns: 3,
    headings: true
};

const cal = (patch: Partial<CalendarOptions> = {}) => buildCalendar({ ...BASE, ...patch });

describe("leap years", () => {
    it("is every four years, except every hundred, except every four hundred", () => {
        // The rule that catches everybody: 1900 was not, 2000 was. A generator
        // that gets this wrong is right for ninety-six years in a hundred,
        // which is the worst possible rate for anybody noticing.
        expect(isLeap(1900)).toBe(false);
        expect(isLeap(2000)).toBe(true);
        expect(isLeap(2024)).toBe(true);
        expect(isLeap(2025)).toBe(false);
        expect(isLeap(2100)).toBe(false);
        expect(isLeap(2400)).toBe(true);
    });

    it("gives February 28 or 29 accordingly", () => {
        expect(daysInMonth(2024, 1)).toBe(29);
        expect(daysInMonth(2025, 1)).toBe(28);
        expect(daysInMonth(1900, 1)).toBe(28);
        expect(daysInMonth(2000, 1)).toBe(29);
    });

    it("knows the short months", () => {
        // April, June, September, November.
        for (const m of [3, 5, 8, 10]) expect(daysInMonth(2026, m)).toBe(30);
        for (const m of [0, 2, 4, 6, 7, 9, 11]) expect(daysInMonth(2026, m)).toBe(31);
    });
});

describe("where the first falls", () => {
    it("agrees with days everybody knows", () => {
        // 1 January 2026 is a Thursday; 4 July 2026 is a Saturday, so 1 July is
        // a Wednesday. Checked against the calendar rather than against us.
        expect(firstColumn(2026, 0, "monday")).toBe(3);   // Mon Tue Wed [Thu]
        expect(firstColumn(2026, 0, "sunday")).toBe(4);   // Sun Mon Tue Wed [Thu]
        expect(firstColumn(2026, 6, "monday")).toBe(2);   // [Wed]
        // 1 March 2020 was a Sunday.
        expect(firstColumn(2020, 2, "sunday")).toBe(0);
        expect(firstColumn(2020, 2, "monday")).toBe(6);
    });

    it("puts the 1st in the column the header names", () => {
        for (const weekStart of ["monday", "sunday"] as const) {
            const lines = monthLines({ ...BASE, weekStart, headings: false }, 0),
                header = lines[0]!,
                first = lines[1]!;
            // Two characters per column plus a space between them.
            const col = firstColumn(2026, 0, weekStart);
            expect(first.slice(col * 3, col * 3 + 2).trim()).toBe("1");
            expect(header.length).toBe(20);
        }
    });
});

describe("the month block", () => {
    it("holds every day of the month and no more", () => {
        for (let m = 0; m < 12; m++) {
            const body = monthLines({ ...BASE, headings: false }, m).slice(1).join(" "),
                aDay = body.trim().split(/\s+/).filter(Boolean).map(Number);
            expect(aDay[0]).toBe(1);
            expect(aDay[aDay.length - 1]).toBe(daysInMonth(2026, m));
            expect(aDay).toHaveLength(daysInMonth(2026, m));
            // Strictly increasing: no day repeated, none skipped.
            expect(aDay.every((n, i) => i === 0 || n === aDay[i - 1]! + 1)).toBe(true);
        }
    });

    it("is the same height every month, so a row of them lines up", () => {
        const heights = Array.from({ length: 12 }, (_, m) => monthLines(BASE, m).length);
        expect(new Set(heights).size).toBe(1);
    });

    it("names the month in the language asked for", () => {
        expect(monthLines({ ...BASE, language: "en" }, 2)[0]).toContain("March");
        expect(monthLines({ ...BASE, language: "de" }, 2)[0]).toContain("März");
        expect(monthLines({ ...BASE, language: "de", headings: false }, 2)[0]).toContain("Di");
    });

    it("rotates the week to start where it was asked", () => {
        expect(monthLines({ ...BASE, headings: false, weekStart: "monday" }, 0)[0]).toBe("Mo Tu We Th Fr Sa Su");
        expect(monthLines({ ...BASE, headings: false, weekStart: "sunday" }, 0)[0]).toBe("Su Mo Tu We Th Fr Sa");
    });
});

describe("the whole year", () => {
    it("covers twelve months, or one", () => {
        expect(cal({ month: null }).aMonth).toHaveLength(12);
        expect(cal({ month: 4 }).aMonth).toEqual([4]);
    });

    it("hands each month over on its own", () => {
        // No longer one padded string. The months are set separately and placed
        // in millimetres, so a month's text is only ever about that month —
        // which is what stops a proportional font walking two of them into
        // each other.
        expect(monthText(BASE, 4)).toContain("May");
        expect(monthText(BASE, 4)).not.toContain("June");
        expect(monthText({ ...BASE, language: "de" }, 2)).toContain("März");
    });

    it("always says whether the year is a leap year", () => {
        expect(cal({ year: 2024 }).warnings.some(s => /2024 is a leap year/.test(s))).toBe(true);
        expect(cal({ year: 2026 }).warnings.some(s => /2026 is not a leap year/.test(s))).toBe(true);
        expect(cal({ year: 2024 }).leap).toBe(true);
    });

    it("says so when the layout is a silly shape", () => {
        expect(cal({ columns: 6 }).warnings.some(s => /very wide, very short/.test(s))).toBe(true);
        expect(cal({ columns: 3 }).warnings.some(s => /very wide, very short/.test(s))).toBe(false);
    });

    it("clamps a year nobody meant", () => {
        expect(cal({ year: 12026 }).year).toBe(2999);
        expect(cal({ year: 3 }).year).toBe(1900);
    });
});

describe("laying the months out", () => {
    const sheet = (w: number, h: number) => ({ width: w, height: h });

    it("gives every month a cell the size of the largest", () => {
        // February is a line shorter than March, and it must not move March.
        const a = [sheet(40, 30), sheet(40, 26), sheet(38, 30)],
            { aPlaced, width, height } = layoutSheets(a, 3, 5);
        expect(width).toBeCloseTo(3 * 40 + 2 * 5);
        expect(height).toBeCloseTo(30);
        // The *cells* are at a fixed pitch; a placed month is centred in its
        // cell, so a narrow one sits a millimetre in and its own x is not on
        // the pitch. That is the point of the cell.
        expect(cellOf(a, 3, 5, 1).x - cellOf(a, 3, 5, 0).x).toBeCloseTo(45);
        expect(cellOf(a, 3, 5, 2).x - cellOf(a, 3, 5, 1).x).toBeCloseTo(45);
        expect(aPlaced[2]!.x - cellOf(a, 3, 5, 2).x).toBeCloseTo(1);
    });

    it("centres a short month in its cell rather than jamming it left", () => {
        const a = [sheet(40, 30), sheet(20, 30)],
            { aPlaced } = layoutSheets(a, 2, 0);
        expect(aPlaced[0]!.x).toBeCloseTo(0);
        expect(aPlaced[1]!.x).toBeCloseTo(40 + 10);
    });

    it("wraps into rows", () => {
        const a = Array.from({ length: 12 }, () => sheet(40, 30)),
            { aPlaced, width, height } = layoutSheets(a, 3, 5);
        expect(width).toBeCloseTo(3 * 40 + 2 * 5);
        expect(height).toBeCloseTo(4 * 30 + 3 * 5);
        expect(aPlaced[3]!.y).toBeCloseTo(35);
        expect(aPlaced[3]!.x).toBeCloseTo(0);
    });

    it("never overlaps two months, whatever their sizes", () => {
        // The bug this replaces: months held apart by space padding, which
        // worked only for as long as the font was monospaced.
        const a = [sheet(40, 30), sheet(55, 22), sheet(31, 41), sheet(48, 28)],
            { aPlaced } = layoutSheets(a, 2, 4),
            cells = a.map((_, i) => cellOf(a, 2, 4, i));
        for (let i = 0; i < cells.length; i++) {
            for (let j = i + 1; j < cells.length; j++) {
                const p1 = cells[i]!, p2 = cells[j]!,
                    apart = p1.x + p1.width <= p2.x + 1e-9 || p2.x + p2.width <= p1.x + 1e-9
                        || p1.y + p1.height <= p2.y + 1e-9 || p2.y + p2.height <= p1.y + 1e-9;
                expect(apart, `cells ${i} and ${j}`).toBe(true);
            }
            expect(aPlaced[i]!.x).toBeGreaterThanOrEqual(cells[i]!.x - 1e-9);
            expect(aPlaced[i]!.x + a[i]!.width).toBeLessThanOrEqual(cells[i]!.x + cells[i]!.width + 1e-9);
        }
    });

    it("copes with nothing to lay out", () => {
        expect(layoutSheets([], 3, 5)).toEqual({ aPlaced: [], width: 0, height: 0 });
    });
});

describe("the card tray", () => {
    it("is as deep as the stack and half a card tall", () => {
        const o = holderOptions(70, 90, 12, 3, 0.15);
        expect(o.dims).toBe("inner");
        expect(o.width).toBeCloseTo(71.5);
        expect(o.depth).toBeGreaterThan(12 * 3);
        expect(o.height).toBeCloseTo(90 * 0.55);
        expect(o.lid).toBe("none");
    });

    it("carries the material through, because the joints depend on it", () => {
        const o = holderOptions(70, 90, 12, 5, 0.2);
        expect(o.thickness).toBe(5);
        expect(o.kerf).toBe(0.2);
    });

    it("stays a usable tray for one card", () => {
        const o = holderOptions(40, 20, 1, 3, 0.15);
        expect(o.depth).toBeGreaterThanOrEqual(12);
        expect(o.height).toBeGreaterThanOrEqual(15);
    });
});
