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
    /** the whole thing as monospaced text */
    text: string;
    /** how many months it covers */
    months: number;
    /** whether the year is a leap year */
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

export const buildCalendar = (opt: CalendarOptions): CalendarResult => {
    const L = CALENDAR_LIMITS,
        warnings: string[] = [],
        year = Math.round(clamp(opt.year, L.minYear, L.maxYear)),
        columns = Math.round(clamp(opt.columns, L.minColumns, L.maxColumns)),
        aMonth = opt.month === null
            ? Array.from({ length: 12 }, (_, i) => i)
            : [Math.round(clamp(opt.month, 0, 11))];

    // Months laid out in rows of `columns`, each block padded to the same width
    // so the columns stay columns.
    const block = aMonth.map(m => monthLines({ ...opt, year }, m)),
        width = Math.max(...block.flat().map(s => s.length)),
        aRow: string[] = [];

    for (let i = 0; i < block.length; i += columns) {
        const row = block.slice(i, i + columns),
            tall = Math.max(...row.map(b => b.length));
        for (let line = 0; line < tall; line++) {
            aRow.push(row.map(b => (b[line] ?? "").padEnd(width, " ")).join("   ").trimEnd());
        }
        if (i + columns < block.length) aRow.push("");
    }

    const head = opt.headings && opt.month === null ? [String(year), ""] : [],
        text = [...head, ...aRow].join("\n").replace(/\n{3,}/g, "\n\n");

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

    return { text, months: aMonth.length, leap: isLeap(year), warnings };
};
