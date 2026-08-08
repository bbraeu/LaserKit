// ---------------------------------------------------------------------------
// Calendars.
//
// A calendar is a table of numbers, and a table of numbers set in a monospaced
// face is a string with newlines in it. So this file works out *what the days
// are* and nothing else; the lettering goes through the text tool, exactly as
// the word search does.
//
// Everything here is arithmetic on dates, which means all of it can be checked
// without a browser — and it needs to be, because a calendar is the one thing
// where being wrong is both invisible and total. A plaque with the 29th of
// February 2027 engraved on it is firewood, and nothing about the drawing says
// so.
//
// Two things are easy to get wrong and are pinned in the tests: the first
// weekday of a month under either convention, and leap years. The rule is not
// "every four years" — 1900 was not a leap year and 2000 was — and a generator
// that gets that wrong is right for ninety-six years out of a hundred, which is
// the worst possible failure rate for noticing.
// ---------------------------------------------------------------------------

import type { BoxOptions } from "./box";

export const CALENDAR_LIMITS = {
    minYear: 1900,
    maxYear: 2999,
    minColumns: 1,
    maxColumns: 6
} as const;

/** Monday or Sunday, which is a question with two right answers. */
export type WeekStart = "monday" | "sunday";

export type CalendarLanguage = "en" | "de";

export interface CalendarOptions {
    year: number;
    /** 0…11 for one month, or null for the whole year */
    month: number | null;
    weekStart: WeekStart;
    language: CalendarLanguage;
    /** months across the sheet, when the whole year is shown */
    columns: number;
    /** the year, and the month names, above their tables */
    headings: boolean;
}

export interface CalendarResult {
    /** the months it covers, 0-indexed */
    aMonth: number[];
    /** the year, once it has been clamped to something real */
    year: number;
    /** whether that year is a leap year */
    leap: boolean;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const MONTHS: Record<CalendarLanguage, string[]> = {
    en: ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"],
    de: ["Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember"]
};

/** Two letters each, from Monday, so a column is two characters wide. */
const DAYS: Record<CalendarLanguage, string[]> = {
    en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
};

/**
 * Whether a year has a 29th of February.
 *
 * Not "every four years". Every four, except every hundred, except every four
 * hundred — 1900 had no 29th and 2000 did. Written out rather than borrowed
 * from `Date`, because it is three comparisons and the alternative is a
 * dependency on how a runtime handles a date nobody means.
 */
export const isLeap = (year: number): boolean =>
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Days in a month, 0-indexed. */
export const daysInMonth = (year: number, month: number): number =>
    [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month] ?? 30;

/**
 * Which column the 1st falls in, counting from the week's first day.
 *
 * `Date.getDay()` is 0 for Sunday whatever anybody's calendar looks like, so
 * the shift into a Monday-first week is done here rather than hoped for. UTC
 * throughout: a local-time Date near midnight lands on the wrong day in half
 * the world.
 */
export const firstColumn = (year: number, month: number, weekStart: WeekStart): number => {
    const sunday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return weekStart === "sunday" ? sunday : (sunday + 6) % 7;
};

/** One month as its heading, its day letters and its rows of numbers. */
export const monthLines = (opt: CalendarOptions, month: number): string[] => {
    const year = Math.round(clamp(opt.year, CALENDAR_LIMITS.minYear, CALENDAR_LIMITS.maxYear)),
        aDay = DAYS[opt.language],
        // Rotated so the week starts where it was asked to.
        header = (opt.weekStart === "sunday" ? [aDay[6]!, ...aDay.slice(0, 6)] : aDay).join(" "),
        width = header.length;

    const out: string[] = [];
    if (opt.headings) {
        const name = MONTHS[opt.language][month]!,
            pad = Math.max(0, Math.floor((width - name.length) / 2));
        out.push(" ".repeat(pad) + name);
    }
    out.push(header);

    const skip = firstColumn(year, month, opt.weekStart),
        days = daysInMonth(year, month);

    let line: string[] = Array.from({ length: skip }, () => "  ");
    for (let d = 1; d <= days; d++) {
        line.push(String(d).padStart(2, " "));
        if (line.length === 7) {
            out.push(line.join(" "));
            line = [];
        }
    }
    if (line.length) out.push(line.join(" ").padEnd(width, " ").trimEnd());

    // Every month is six rows tall whether it needs them or not, so the months
    // in a row of a year calendar line up instead of stepping.
    const rows = opt.headings ? 8 : 7;
    while (out.length < rows) out.push("");
    return out;
};

/**
 * Which months, and everything true about the year.
 *
 * This used to compose the whole calendar as one string, with the months held
 * apart by padding every block with spaces. That works exactly as long as the
 * font is monospaced — and the tool has a font picker, so it was one click from
 * months walking into each other. Space padding is not a layout. The months are
 * set one at a time now and placed in millimetres by `layoutSheets`.
 */
export const buildCalendar = (opt: CalendarOptions): CalendarResult => {
    const L = CALENDAR_LIMITS,
        warnings: string[] = [],
        year = Math.round(clamp(opt.year, L.minYear, L.maxYear)),
        columns = Math.round(clamp(opt.columns, L.minColumns, L.maxColumns)),
        aMonth = opt.month === null
            ? Array.from({ length: 12 }, (_, i) => i)
            : [Math.round(clamp(opt.month, 0, 11))];

    // ── sanity ──────────────────────────────────────────────────────────
    if (opt.month === null && columns > 4) {
        warnings.push(
            `${columns} months across makes a very wide, very short plaque. Three or four is the shape a year `
            + "calendar wants."
        );
    }
    if (year !== Math.round(opt.year)) {
        warnings.push(`Only ${L.minYear} to ${L.maxYear} are offered; the year has been clamped to ${year}.`);
    }
    warnings.push(
        `${year} ${isLeap(year) ? "is" : "is not"} a leap year, so February has `
        + `${daysInMonth(year, 1)} days. Check that against a calendar you trust before you cut it — this is the one `
        + "thing here that is either right or firewood."
    );

    return { aMonth, year, leap: isLeap(year), warnings };
};

// ---------------------------------------------------------------------------
// Laying the months out
//
// The first version of this padded every month block with spaces so the columns
// lined up, and then set the whole calendar as one piece of text. That works
// only for as long as the font is monospaced — and the tool offers a font
// picker, so it was one click away from months walking into each other. Space
// padding is not a layout.
//
// Each month is its own block of text now, set on its own and *placed in
// millimetres*. Nothing about the font can make two months collide, the gap
// between them is a real measurement rather than three space characters, and
// there is somewhere to put a frame.
// ---------------------------------------------------------------------------

/** One month as its own block of text, with no padding for its neighbours. */
export const monthText = (opt: CalendarOptions, month: number): string =>
    monthLines(opt, month).join("\n").replace(/\n+$/, "");

/** Anything with a size, which for the layout is all a month is. */
export interface Sized {
    width: number;
    height: number;
}

export interface Placed extends Sized {
    x: number;
    y: number;
}

/**
 * Months on a grid, every cell the size of the largest.
 *
 * A uniform cell rather than a packed one: a calendar is a table, and a table
 * whose columns are as wide as their widest entry is a table, while one whose
 * columns each shrink to fit is a mess. February being a line shorter than
 * March must not move March.
 */
export const layoutSheets = (
    aSheet: Sized[],
    columns: number,
    gap: number
): { aPlaced: Placed[]; width: number; height: number } => {
    if (!aSheet.length) return { aPlaced: [], width: 0, height: 0 };
    const cols = Math.max(1, Math.round(columns)),
        cellW = Math.max(...aSheet.map(o => o.width)),
        cellH = Math.max(...aSheet.map(o => o.height)),
        rows = Math.ceil(aSheet.length / cols);

    const aPlaced = aSheet.map((o, i) => ({
        // Centred in its cell, so a short month sits under the middle of the
        // column rather than hard against its left edge.
        x: (i % cols) * (cellW + gap) + (cellW - o.width) / 2,
        y: Math.floor(i / cols) * (cellH + gap) + (cellH - o.height) / 2,
        width: o.width,
        height: o.height
    }));

    return {
        aPlaced,
        width: cols * cellW + (cols - 1) * gap,
        height: rows * cellH + (rows - 1) * gap
    };
};

/** The cell a sheet sits in, which is what a frame is drawn round. */
export const cellOf = (aSheet: Sized[], columns: number, gap: number, i: number): Placed => {
    const cols = Math.max(1, Math.round(columns)),
        cellW = Math.max(...aSheet.map(o => o.width)),
        cellH = Math.max(...aSheet.map(o => o.height));
    return {
        x: (i % cols) * (cellW + gap),
        y: Math.floor(i / cols) * (cellH + gap),
        width: cellW,
        height: cellH
    };
};

// ---------------------------------------------------------------------------
// Somewhere to keep them
//
// Twelve loose cards are twelve things to lose, so the tool offers a tray to
// stand them in. It is not a second box generator: it is *the* box generator,
// called with the numbers the cards imply. A tray for calendar cards and a
// parts sorter are the same object, and the finger joints, the kerf
// compensation and the nesting are already right there and already tested.
// ---------------------------------------------------------------------------

/** What a tray for this many cards of this size has to be. */
export const holderOptions = (
    cardW: number,
    cardH: number,
    count: number,
    thickness: number,
    kerf: number
): BoxOptions => ({
    // Measured inside: what has to fit is the cards, not the tray.
    dims: "inner",
    // As wide as a card and a little, so one can be lifted out without
    // scraping down both walls.
    width: cardW + 1.5,
    // As deep as the stack, plus a finger's room behind it.
    depth: Math.max(12, count * (thickness + 0.4) + 6),
    // Half a card tall, so the month you want is readable without taking it
    // out — which is the whole point of standing them up.
    height: Math.max(15, cardH * 0.55),
    thickness,
    kerf,
    clearance: 0,
    finger: 0,
    lid: "none",
    cornerRadius: 0,
    cornerPattern: "tee",
    cornerPitch: 3,
    cornerLink: 6,
    panelJoint: "edge",
    panelOffset: 6,
    lidClearance: 0.1,
    lidLip: false,
    lidHeight: 25,
    pin: 3,
    hingeOffset: 3,
    dividersW: 0,
    dividersD: 0,
    dividerHeight: 0,
    sheetWidth: 400,
    gap: 4,
    labels: false
});
