import { describe, expect, it } from "vitest";
import { buildWordSearch, cleanWord, gridText, listText } from "../../src/lib/wordsearch";
import type { WordSearchOptions } from "../../src/lib/wordsearch";

// The one unforgivable bug in a word search is a puzzle that asks for a word it
// does not contain: somebody looks for twenty minutes and the answer is that
// the generator gave up quietly. So what is pinned hardest here is that every
// word on the list is findable in the grid, read back out of the grid itself
// rather than trusted from the placement list.

const BASE: WordSearchOptions = {
    cols: 12,
    rows: 12,
    words: ["laser", "kerf", "plywood", "engrave", "acrylic", "focus"],
    directions: "all",
    backwards: true,
    smartFill: true,
    seed: 5
};

const ws = (patch: Partial<WordSearchOptions> = {}) => buildWordSearch({ ...BASE, ...patch });

/** Search the finished grid the way a person would. */
const findable = (grid: string[], word: string): boolean => {
    const rows = grid.length,
        cols = grid[0]!.length,
        aDir = [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            for (const [dr, dc] of aDir) {
                let ok = true;
                for (let i = 0; i < word.length && ok; i++) {
                    const rr = r + dr * i, cc = c + dc * i;
                    ok = rr >= 0 && rr < rows && cc >= 0 && cc < cols && grid[rr]![cc] === word[i];
                }
                if (ok) return true;
            }
        }
    }
    return false;
};

describe("every word on the list is in the grid", () => {
    it("for a dozen different seeds", () => {
        for (let seed = 1; seed <= 12; seed++) {
            const r = ws({ seed });
            for (const p of r.placed) {
                expect(findable(r.grid, p.word), `seed ${seed}: ${p.word}`).toBe(true);
            }
        }
    });

    it("and the ones that did not fit are off the list, not silently missing", () => {
        // A twenty-letter word in a six-square grid cannot go in. What must not
        // happen is that it stays on the word list.
        const r = ws({ cols: 6, rows: 6, words: ["antidisestablishment", "kerf"] });
        expect(r.dropped).toContain("ANTIDISESTABLISHMENT");
        expect(r.placed.map(p => p.word)).not.toContain("ANTIDISESTABLISHMENT");
        expect(listText(r, 2)).not.toContain("ANTIDIS");
        expect(r.warnings.some(s => /would not fit/.test(s))).toBe(true);
    });

    it("even when every word runs one way only", () => {
        const r = ws({ directions: "across", backwards: false });
        for (const p of r.placed) expect(findable(r.grid, p.word)).toBe(true);
        expect(r.placed.every(p => p.dRow === 0 && p.dCol === 1)).toBe(true);
    });
});

describe("the grid itself", () => {
    it("is the size that was asked for", () => {
        const r = ws({ cols: 15, rows: 9 });
        expect(r.grid).toHaveLength(9);
        expect(r.grid.every(row => row.length === 15)).toBe(true);
    });

    it("is letters all the way through, with no holes left", () => {
        expect(ws().grid.every(row => /^[A-ZÄÖÜß]+$/.test(row))).toBe(true);
    });

    it("fills the gaps from the words' own letters when asked", () => {
        // A grid padded with the whole alphabet gives itself away: a stray Q
        // says there is nothing to find there.
        const smart = ws({ smartFill: true, words: ["abc", "cab"] }).grid.join(""),
            dumb = ws({ smartFill: false, words: ["abc", "cab"] }).grid.join("");
        expect(new Set(smart).size).toBeLessThanOrEqual(3);
        expect(new Set(dumb).size).toBeGreaterThan(10);
    });

    it("lets words cross where they agree on a letter", () => {
        // Crossings are what make a grid feel dense rather than sparse.
        const r = ws({ cols: 10, rows: 10, words: ["laser", "kerf", "focus", "acrylic", "plywood", "engrave"], seed: 3 });
        const used = new Map<string, number>();
        for (const p of r.placed) {
            for (let i = 0; i < p.word.length; i++) {
                const k = `${p.row + p.dRow * i},${p.col + p.dCol * i}`;
                used.set(k, (used.get(k) ?? 0) + 1);
            }
        }
        expect([...used.values()].some(n => n > 1)).toBe(true);
    });

    it("is the same puzzle for the same seed", () => {
        expect(ws({ seed: 9 }).grid).toEqual(ws({ seed: 9 }).grid);
        expect(ws({ seed: 9 }).grid).not.toEqual(ws({ seed: 10 }).grid);
    });
});

describe("directions", () => {
    it("keeps to the ones allowed", () => {
        const across = ws({ directions: "across", backwards: false });
        expect(across.placed.every(p => p.dRow === 0)).toBe(true);

        const plus = ws({ directions: "acrossDown", backwards: false });
        expect(plus.placed.every(p => (p.dRow === 0 && p.dCol === 1) || (p.dRow === 1 && p.dCol === 0))).toBe(true);

        const all = ws({ directions: "all", backwards: true, seed: 2 });
        expect(new Set(all.placed.map(p => `${p.dRow},${p.dCol}`)).size).toBeGreaterThan(2);
    });

    it("only reverses when backwards is allowed", () => {
        const forward = ws({ directions: "all", backwards: false });
        expect(forward.placed.every(p => p.dRow >= 0 && (p.dRow !== 0 || p.dCol > 0))).toBe(true);
    });
});

describe("the text it hands over", () => {
    it("spaces the grid out, because a monospace face sets it too tight", () => {
        // Five is the smallest grid there is; anything under it is clamped.
        const r = ws({ cols: 5, rows: 5 });
        const lines = gridText(r).split("\n");
        expect(lines).toHaveLength(5);
        expect(lines[0]).toMatch(/^[A-Z]( [A-Z]){4}$/);
    });

    it("lists the words in columns, alphabetically", () => {
        const r = ws({ words: ["zebra", "apple", "mango", "kiwi"], cols: 14, rows: 14 });
        const list = listText(r, 2);
        expect(list.split("\n")).toHaveLength(2);
        expect(list.indexOf("APPLE")).toBeLessThan(list.indexOf("ZEBRA"));
    });

    it("has nothing to list when nothing went in", () => {
        expect(listText(ws({ words: [] }), 2)).toBe("");
    });
});

describe("cleanWord", () => {
    it("keeps letters and drops everything else", () => {
        expect(cleanWord("Laser-Cutter 2!")).toBe("LASERCUTTER");
        // Upper case turns ß into SS, so the word comes out a letter longer in
        // the grid than it was typed. Correct, and worth knowing.
        expect(cleanWord("größe")).toBe("GRÖSSE");
    });
});
