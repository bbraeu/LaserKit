// ---------------------------------------------------------------------------
// Word search grids.
//
// Two halves that are deliberately kept apart.
//
// *Placing the words* is pure arithmetic on a grid of characters, and it is all
// in this file: no DOM, no canvas, fully testable. That matters more than it
// sounds, because the failure everybody ships is a puzzle containing a word
// that is not actually in it — the solver looks for twenty minutes and the
// answer is that the generator gave up quietly on the fourth one.
//
// *Turning letters into geometry* is not here at all. The text tool already
// sets type in any installed font and traces it, and doing that a second time
// would be a second thing to keep correct. This file hands back a string with
// newlines in it; the tool passes that to `buildTextDesign` in a monospaced
// face, where a grid of letters is just text that happens to line up.
// ---------------------------------------------------------------------------

import { pathData, r3, rectRing, shiftRing } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity } from "./dxf";
import { buildFds } from "./fds";
import type { TextLayer, TextResult } from "./text";

export const WORDSEARCH_LIMITS = {
    minGrid: 5,
    maxGrid: 30,
    maxWords: 40,
    maxWordLength: 30
} as const;

/** Which ways a word may run. */
export type Directions = "across" | "acrossDown" | "all";

export interface WordSearchOptions {
    cols: number;
    rows: number;
    /** the words to hide; anything not a letter is stripped */
    words: string[];
    directions: Directions;
    /** words may also read backwards */
    backwards: boolean;
    /**
     * Fill the gaps with letters taken from the words themselves.
     *
     * A grid padded with the whole alphabet gives the game away: the eye finds
     * a Q and knows there is nothing there. Drawing the filler from the same
     * letters the words use is the single biggest thing that makes a grid hard.
     */
    smartFill: boolean;
    seed: number;
}

/** Where one word ended up. */
export interface Placement {
    word: string;
    row: number;
    col: number;
    /** step per letter */
    dRow: number;
    dCol: number;
}

export interface WordSearchResult {
    /** the grid, one string per row */
    grid: string[];
    placed: Placement[];
    /** words that would not go in, in the order they were given */
    dropped: string[];
    cols: number;
    rows: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const rng = (seed: number): (() => number) => {
    let a = (Math.floor(seed) || 1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * Letters only, upper case — a word search has no room for punctuation.
 *
 * Note what upper case does to German: `ß` becomes `SS`, so "GRÖSSE" is six
 * letters in the grid and not five. That is correct — it is how the word is
 * spelled in capitals, which is what the grid is in — but it does mean a word
 * can come out longer than it was typed.
 */
export const cleanWord = (s: string): string =>
    s.toUpperCase().replace(/[^A-ZÄÖÜ]/g, "").slice(0, WORDSEARCH_LIMITS.maxWordLength);

const STEPS: Record<Directions, [number, number][]> = {
    across: [[0, 1]],
    acrossDown: [[0, 1], [1, 0]],
    all: [[0, 1], [1, 0], [1, 1], [1, -1]]
};

export const buildWordSearch = (opt: WordSearchOptions): WordSearchResult => {
    const L = WORDSEARCH_LIMITS,
        warnings: string[] = [],
        cols = Math.round(clamp(opt.cols, L.minGrid, L.maxGrid)),
        rows = Math.round(clamp(opt.rows, L.minGrid, L.maxGrid)),
        next = rng(opt.seed);

    const aWord = opt.words
        .map(cleanWord)
        .filter(s => s.length > 1)
        .slice(0, L.maxWords)
        // Longest first: a long word has far fewer places it can go, and fitting
        // it around the short ones already placed is what fails.
        .sort((a, b) => b.length - a.length);

    const cell: (string | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null)),
        placed: Placement[] = [],
        dropped: string[] = [];

    /** Every direction a word may run, including backwards when allowed. */
    const aStep: [number, number][] = STEPS[opt.directions].flatMap(([dr, dc]) =>
        opt.backwards ? [[dr, dc] as [number, number], [-dr, -dc] as [number, number]] : [[dr, dc] as [number, number]]);

    /**
     * Whether a word goes here, and how many letters it would share if it does.
     *
     * −1 for "it does not fit". The count matters: a word laid across three
     * others makes a denser, harder grid than one dropped in an empty corner,
     * and preferring crossings is most of the difference between a generated
     * puzzle and one somebody made.
     */
    const score = (word: string, r: number, c: number, dr: number, dc: number): number => {
        let cross = 0;
        for (let i = 0; i < word.length; i++) {
            const rr = r + dr * i,
                cc = c + dc * i;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) return -1;
            const at = cell[rr]![cc];
            if (at === null) continue;
            // Crossing another word is allowed — wanted, even — but only where
            // the two agree about the letter.
            if (at !== word[i]) return -1;
            cross++;
        }
        return cross;
    };

    for (const word of aWord) {
        // Every start and every direction, shuffled, and the first that fits
        // wins. Exhaustive rather than "try 200 random spots and give up":
        // giving up quietly is how a puzzle ends up missing a word.
        const aTry: [number, number, number, number][] = [];
        for (const [dr, dc] of aStep) {
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) aTry.push([r, c, dr, dc]);
            }
        }
        for (let i = aTry.length - 1; i > 0; i--) {
            const j = Math.floor(next() * (i + 1));
            [aTry[i], aTry[j]] = [aTry[j]!, aTry[i]!];
        }

        // Shuffled first and then scored, so the best-crossing spot wins and
        // ties are broken at random rather than always landing top-left.
        let spot: [number, number, number, number] | null = null,
            best = -1;
        for (const t of aTry) {
            const n2 = score(word, t[0], t[1], t[2], t[3]);
            if (n2 > best) {
                best = n2;
                spot = t;
                // Nothing beats sharing every letter, and looking further
                // through six thousand candidates for a word that is already
                // spelled out is wasted work.
                if (n2 === word.length) break;
            }
        }
        if (!spot) {
            dropped.push(word);
            continue;
        }
        const [r, c, dr, dc] = spot;
        for (let i = 0; i < word.length; i++) cell[r + dr * i]![c + dc * i] = word[i]!;
        placed.push({ word, row: r, col: c, dRow: dr, dCol: dc });
    }

    // ── the filler ──────────────────────────────────────────────────────
    const pool = opt.smartFill && aWord.length
        ? [...new Set(aWord.join("").split(""))].join("")
        : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    const grid = cell.map(row =>
        row.map(ch => ch ?? pool[Math.floor(next() * pool.length)]!).join(""));

    // ── sanity ──────────────────────────────────────────────────────────
    if (dropped.length) {
        warnings.push(
            `${dropped.length} word${dropped.length > 1 ? "s" : ""} would not fit and ${dropped.length > 1 ? "are" : "is"} `
            + `not in the grid: ${dropped.join(", ")}. They are left off the list too — a puzzle that asks for a word `
            + "it does not contain is the one unforgivable bug in a word search."
        );
    }
    if (!placed.length) {
        warnings.push("No words have been hidden, so this is a grid of random letters.");
    }
    const longest = Math.max(0, ...aWord.map(s => s.length));
    if (longest > Math.max(cols, rows)) {
        warnings.push(`“${aWord.find(s => s.length === longest)}” is ${longest} letters and the grid is only ${Math.max(cols, rows)} across.`);
    }
    if (opt.directions === "across" && placed.length > 1) {
        warnings.push("Every word runs left to right, which makes this a reading exercise rather than a puzzle.");
    }
    if (!opt.smartFill && placed.length) {
        warnings.push(
            "The gaps are filled from the whole alphabet, so a stray Q or X gives away where there is nothing to "
            + "find. Filling from the words' own letters is what makes a grid hard."
        );
    }

    return { grid, placed, dropped, cols, rows, warnings };
};

/**
 * The lettering, on a rectangular board.
 *
 * The text tool can weld a plate round a word for you, but every plate it makes
 * hugs the ink — which is right for a keychain and wrong here: a title narrower
 * than the grid leaves a notch in the top corner, and a word search is a board,
 * not a silhouette. So the letters are set with no plate at all and a rectangle
 * is put round them here.
 */
export const frameDesign = (
    design: TextResult,
    margin: number,
    radius: number
): { aLayer: TextLayer[]; width: number; height: number; preview: string } => {
    const width = design.width + 2 * margin,
        height = design.height + 2 * margin,
        board = rectRing({ x0: 0, y0: 0, x1: width, y1: height }, Math.max(0, Math.min(radius, Math.min(width, height) / 2)));

    const aLayer: TextLayer[] = [
        ...design.aLayer.map(l => ({ ...l, rings: l.rings.map(a => shiftRing(a, margin, margin)) })),
        { operation: OPERATION_COLORS.VECTOR_CUTTING!, rings: [board], filled: false }
    ];

    const body = aLayer.map(l => {
        const d = l.rings.map(a => pathData(a, !l.open)).join(" ");
        return l.filled
            ? `<path d="${d}" fill="${l.operation.css}" fill-rule="evenodd"/>`
            : `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="0.3"/>`;
    }).join("");

    return {
        aLayer,
        width,
        height,
        preview: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(width)}mm" height="${r3(height)}mm"`
            + ` viewBox="0 0 ${r3(width)} ${r3(height)}">${body}</svg>`
    };
};

/**
 * The grid as one block of text, a space between columns.
 *
 * Spaced out because a monospaced face sets letters far closer together than a
 * word search wants: unspaced, the rows read as words and the eye follows them
 * instead of searching.
 */
export const gridText = (r: WordSearchResult): string =>
    r.grid.map(row => [...row].join(" ")).join("\n");

/** The words that are actually in the grid, laid out in columns. */
export const listText = (r: WordSearchResult, columns: number): string => {
    const aWord = r.placed.map(p => p.word).sort();
    if (!aWord.length) return "";
    const n = Math.max(1, Math.round(columns)),
        rows = Math.ceil(aWord.length / n),
        width = Math.max(...aWord.map(s => s.length));

    const out: string[] = [];
    for (let r0 = 0; r0 < rows; r0++) {
        const line: string[] = [];
        for (let c = 0; c < n; c++) {
            const w = aWord[c * rows + r0];
            if (w) line.push(w.padEnd(width, " "));
        }
        out.push(line.join("   ").trimEnd());
    }
    return out.join("\n");
};

// ---------------------------------------------------------------------------
// Output
//
// The framed board rather than the text tool's own result, so what is exported
// is what is on the canvas: a rectangle with lettering inside it.
// ---------------------------------------------------------------------------

export interface Framed {
    aLayer: TextLayer[];
    width: number;
    height: number;
}

export const framedToSvg = (r: Framed): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + r.aLayer.map(l => {
        const d = l.rings.map(a => pathData(a, !l.open)).join(" ");
        return l.filled
            ? `<path d="${d}" fill="${l.operation.css}" fill-rule="evenodd"/>`
            : `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="0.3"/>`;
    }).join("")
    + "</svg>";

export const framedToDxf = (r: Framed): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.rings.map(a => ({
            color: l.operation.color,
            closed: !l.open,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const framedToFds = (r: Framed): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: l.filled ? 0 : l.open ? 1 : 2,
        subpaths: l.rings.map(a => ({ points: a, closed: !l.open }))
    })));
