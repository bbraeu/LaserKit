import { describe, expect, it } from "vitest";
import { buildCalendar, daysInMonth, firstColumn, isLeap, monthLines } from "../../src/lib/calendar";
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
    it("lays twelve months out in rows", () => {
        const r = cal({ month: null, columns: 3 });
        expect(r.months).toBe(12);
        for (const name of ["January", "June", "December"]) expect(r.text).toContain(name);
        expect(r.text.split("\n")[0]).toBe("2026");
    });

    it("does one month on its own", () => {
        const r = cal({ month: 4 });
        expect(r.months).toBe(1);
        expect(r.text).toContain("May");
        expect(r.text).not.toContain("June");
    });

    it("keeps the columns aligned, whatever the month names are", () => {
        // The blocks are padded to one width, so every row of months puts its
        // day letters at the same character offsets. Measured on the header
        // lines: a day row legitimately starts with blanks when the 1st falls
        // mid-week, but a header never does.
        const r = cal({ month: null, columns: 3, language: "de" });
        const headers = r.text.split("\n").filter(s => s.startsWith("Mo Di"));
        expect(headers).toHaveLength(4);
        expect(new Set(headers).size).toBe(1);
        // …and each of the three months is there, evenly spaced.
        expect(headers[0]!.match(/Mo Di/g)).toHaveLength(3);
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
        expect(cal({ year: 12026 }).text).toContain("2999");
        expect(cal({ year: 3 }).text).toContain("1900");
    });
});
