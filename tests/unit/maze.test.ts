import { describe, expect, it } from "vitest";
import { buildMaze } from "../../src/lib/maze";
import type { MazeOptions } from "../../src/lib/maze";

// A maze is either solvable or it is a picture of a maze, and nothing on the
// canvas tells the two apart at a glance. So what is pinned here is that every
// cell can be reached, that there is exactly one way between any two of them,
// and that the same seed gives the same maze — because without that last one
// the maze on screen is never the maze that got exported.

const BASE: MazeOptions = {
    cols: 12,
    rows: 9,
    cell: 6,
    border: 5,
    ends: "corners",
    braid: 0,
    seed: 7,
    outline: true
};

const maze = (patch: Partial<MazeOptions> = {}) => buildMaze({ ...BASE, ...patch });

/**
 * The maze read back out of its own walls.
 *
 * Deliberately not the generator's internal graph: what matters is whether the
 * *drawing* is solvable, and the drawing is all anyone gets.
 */
const graphFromWalls = (o: MazeOptions) => {
    const r = buildMaze(o),
        { cols, rows, cell, border } = { ...o, cell: o.cell, border: o.border };
    // Every wall line, as the set of unit segments it covers.
    const hWall = new Set<string>(),
        vWall = new Set<string>();
    for (const layer of r.aLayer) {
        if (!layer.open) continue;
        for (const a of layer.rings) {
            const [p, q] = [a[0]!, a[1]!];
            if (Math.abs(p.y - q.y) < 1e-9) {
                const row = Math.round((p.y - border) / cell);
                for (let c = Math.round((Math.min(p.x, q.x) - border) / cell); c < Math.round((Math.max(p.x, q.x) - border) / cell); c++) {
                    hWall.add(`${row},${c}`);
                }
            } else {
                const col = Math.round((p.x - border) / cell);
                for (let rr = Math.round((Math.min(p.y, q.y) - border) / cell); rr < Math.round((Math.max(p.y, q.y) - border) / cell); rr++) {
                    vWall.add(`${rr},${col}`);
                }
            }
        }
    }

    const id = (rr: number, c: number) => rr * cols + c,
        link: number[][] = Array.from({ length: rows * cols }, () => []);
    for (let rr = 0; rr < rows; rr++) {
        for (let c = 0; c < cols; c++) {
            if (rr + 1 < rows && !hWall.has(`${rr + 1},${c}`)) {
                link[id(rr, c)]!.push(id(rr + 1, c));
                link[id(rr + 1, c)]!.push(id(rr, c));
            }
            if (c + 1 < cols && !vWall.has(`${rr},${c + 1}`)) {
                link[id(rr, c)]!.push(id(rr, c + 1));
                link[id(rr, c + 1)]!.push(id(rr, c));
            }
        }
    }
    return { link, cells: rows * cols, result: r };
};

const reachable = (link: number[][], from = 0): number => {
    const seen = new Set([from]),
        queue = [from];
    for (let i = 0; i < queue.length; i++) {
        for (const n of link[queue[i]!]!) {
            if (seen.has(n)) continue;
            seen.add(n);
            queue.push(n);
        }
    }
    return seen.size;
};

describe("the maze it draws", () => {
    it("can be walked to every cell", () => {
        // Read out of the wall lines, not out of the generator: a merge bug
        // that welded two runs together would close a corridor, and only this
        // catches it.
        for (const seed of [1, 2, 3, 42, 999]) {
            const g = graphFromWalls({ ...BASE, seed });
            expect(reachable(g.link), `seed ${seed}`).toBe(g.cells);
        }
    });

    it("has exactly one route between any two cells", () => {
        // A perfect maze on n cells has exactly n−1 connections. One more is a
        // loop; one fewer is a corner nobody can reach.
        const g = graphFromWalls(BASE),
            edges = g.link.reduce((n, a) => n + a.length, 0) / 2;
        expect(edges).toBe(g.cells - 1);
    });

    it("grows loops when it is asked to, and only then", () => {
        const plain = graphFromWalls({ ...BASE, braid: 0 }),
            braided = graphFromWalls({ ...BASE, braid: 1 }),
            count = (g: typeof plain) => g.link.reduce((n, a) => n + a.length, 0) / 2;
        expect(count(braided)).toBeGreaterThan(count(plain));
        // …and it is still all one maze rather than two halves.
        expect(reachable(braided.link)).toBe(braided.cells);
    });

    it("is the same maze for the same seed and a different one otherwise", () => {
        expect(maze({ seed: 5 }).preview).toBe(maze({ seed: 5 }).preview);
        expect(maze({ seed: 5 }).preview).not.toBe(maze({ seed: 6 }).preview);
        // The seed survives everything that is not the maze: changing the
        // corridor width must not reshuffle a single wall.
        const a = graphFromWalls({ ...BASE, seed: 5, cell: 6 }),
            b = graphFromWalls({ ...BASE, seed: 5, cell: 11 });
        expect(a.link).toEqual(b.link);
    });
});

describe("the way in and the way out", () => {
    it("solves from one to the other", () => {
        expect(maze({ ends: "corners" }).solutionLength).toBeGreaterThan(1);
        expect(maze({ ends: "sides" }).solutionLength).toBeGreaterThan(1);
        expect(maze({ ends: "topBottom" }).solutionLength).toBeGreaterThan(1);
    });

    it("leaves the border closed when there is no way in", () => {
        const r = maze({ ends: "none" });
        expect(r.solution).toHaveLength(0);
        expect(r.warnings.some(s => /pattern rather than a maze/.test(s))).toBe(true);
    });

    it("walks a route that only ever steps to a neighbouring cell", () => {
        // A solution that jumps is a solver reading a graph the walls do not
        // describe.
        const r = maze();
        for (let i = 1; i < r.solution.length; i++) {
            const d = Math.hypot(r.solution[i]!.x - r.solution[i - 1]!.x, r.solution[i]!.y - r.solution[i - 1]!.y);
            expect(d).toBeCloseTo(BASE.cell);
        }
    });
});

describe("the drawing", () => {
    it("merges collinear walls into far fewer lines", () => {
        // A 30 × 30 grid has 1 860 possible walls and a perfect maze knocks
        // 899 of them out, so a shade under a thousand are left standing.
        const r = maze({ cols: 30, rows: 30 });
        expect(r.segments).toBeGreaterThan(900);
        expect(r.walls).toBeLessThan(r.segments * 0.75);
    });

    it("engraves the walls and cuts only the outline", () => {
        const r = maze({ outline: true });
        expect(r.aLayer.filter(l => l.open)).toHaveLength(1);
        const cut = r.aLayer.find(l => !l.open)!;
        // One closed ring: the piece. Never a wall.
        expect(cut.rings).toHaveLength(1);
        expect(r.aLayer.find(l => l.open)!.operation.name).toBe("Line Engraving");
    });

    it("drops the outline, and says the walls are then all there is", () => {
        const r = maze({ outline: false });
        expect(r.aLayer.every(l => l.open)).toBe(true);
        expect(r.warnings.some(s => /engrave it onto something/.test(s))).toBe(true);
    });

    it("sizes the piece to the cells plus the border on both sides", () => {
        const r = maze({ cols: 10, rows: 8, cell: 5, border: 7 });
        expect(r.width).toBe(10 * 5 + 14);
        expect(r.height).toBe(8 * 5 + 14);
    });

    it("keeps every wall inside the piece", () => {
        const r = maze();
        for (const l of r.aLayer) {
            for (const a of l.rings) {
                for (const q of a) {
                    expect(q.x).toBeGreaterThanOrEqual(-0.01);
                    expect(q.y).toBeGreaterThanOrEqual(-0.01);
                    expect(q.x).toBeLessThanOrEqual(r.width + 0.01);
                    expect(q.y).toBeLessThanOrEqual(r.height + 0.01);
                }
            }
        }
    });
});

describe("warnings", () => {
    it("says when the corridors are too narrow to engrave", () => {
        expect(maze({ cell: 2 }).warnings.some(s => /grey block/.test(s))).toBe(true);
        expect(maze({ cell: 6 }).warnings.some(s => /grey block/.test(s))).toBe(false);
    });

    it("says what braiding actually does", () => {
        expect(maze({ braid: 0.5 }).warnings.some(s => /looks .*harder and solves easier/.test(s))).toBe(true);
    });

    it("says when it is a very long job", () => {
        expect(maze({ cols: 90, rows: 90 }).warnings.some(s => /long job/.test(s))).toBe(true);
    });
});
