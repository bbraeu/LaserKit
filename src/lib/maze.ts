import { pathData, r3, rectRing } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Operation, Point } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Mazes.
//
// A maze is engraved, not cut, and that single fact decides the whole tool. Cut
// the walls of a maze and you have not made a maze — you have made a pile of
// loose rectangles, because a wall drawn as a line and cut becomes a slot with
// nothing holding either side. So the walls go out as line engraving, only the
// border is cut, and the tool never offers otherwise.
//
// The generator is a recursive backtracker: stand in a cell, walk to a random
// neighbour you have not been to, knock the wall down behind you, and when you
// are boxed in, back up to the last cell that still had a way out. It makes a
// *perfect* maze — exactly one route between any two cells, no loops, no
// unreachable corners — which is the kind everybody means by "maze" and the
// only kind whose difficulty is honestly described by its size.
//
// Two things are then done to it deliberately.
//
// *Braiding* knocks a wall out of some dead ends, which adds loops. That makes
// a maze that reads as harder — you can no longer solve it by never turning
// back — while actually being easier to blunder through. It is offered because
// people like the look, and labelled for what it does.
//
// *Runs are merged.* A row of a hundred separate 5 mm wall segments is a
// hundred pen-down/pen-up pairs, and the head spends longer travelling than
// burning. Collinear neighbours become one polyline, which on a big maze cuts
// the job time by more than half and is invisible in the result.
// ---------------------------------------------------------------------------

const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

export const MAZE_LIMITS = {
    minCells: 2,
    maxCells: 120,
    minCell: 1,
    maxCell: 60,
    maxBorder: 60
} as const;

/** Which two edges the way in and the way out are cut into. */
export type MazeEnds = "corners" | "sides" | "topBottom" | "none";

export interface MazeOptions {
    /** cells across and down */
    cols: number;
    rows: number;
    /** one cell, mm — the width of a corridor */
    cell: number;
    /** solid material around the maze, mm */
    border: number;
    ends: MazeEnds;
    /**
     * How many dead ends to open up, 0…1.
     *
     * 0 is a perfect maze: one route between any two points. Above that it
     * grows loops, which looks harder and solves easier.
     */
    braid: number;
    /** what makes this maze this maze; the same seed always gives the same one */
    seed: number;
    /** cut the outline as well as engraving the walls */
    outline: boolean;
}

export interface MazeLayer {
    operation: Operation;
    rings: Point[][];
    open?: boolean;
}

export interface MazeResult {
    preview: string;
    aLayer: MazeLayer[];
    width: number;
    height: number;
    /** the way through, cell centre to cell centre — a view aid, never exported */
    solution: Point[];
    cells: number;
    /** separate wall lines after collinear runs were merged */
    walls: number;
    /** how many there would have been unmerged, for the note that explains it */
    segments: number;
    /** cells with only one way in and out */
    deadEnds: number;
    /** how many cells the solution passes through */
    solutionLength: number;
    engraveLength: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

/**
 * A small deterministic generator.
 *
 * `Math.random` would make the maze different on every keystroke: dragging the
 * cell size would reshuffle the walls, and the maze on screen would never be
 * the maze you exported. The seed is a control for exactly that reason.
 */
const rng = (seed: number): (() => number) => {
    let a = (Math.floor(seed) || 1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** Walls as two grids: one above each cell, one to the left of each cell. */
interface Grid {
    cols: number;
    rows: number;
    /** (rows + 1) × cols — the wall above cell (r, c) */
    h: boolean[][];
    /** rows × (cols + 1) — the wall to the left of cell (r, c) */
    v: boolean[][];
    /** which cells each cell can reach, for the solver */
    link: number[][];
}

const carve = (cols: number, rows: number, next: () => number): Grid => {
    const h = Array.from({ length: rows + 1 }, () => Array.from({ length: cols }, () => true)),
        v = Array.from({ length: rows }, () => Array.from({ length: cols + 1 }, () => true)),
        seen = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false)),
        link: number[][] = Array.from({ length: rows * cols }, () => []),
        id = (r: number, c: number): number => r * cols + c;

    // Iterative rather than recursive: a 120 × 120 maze is 14 400 cells deep in
    // the worst case, and that is a blown stack rather than a slow function.
    const stack: [number, number][] = [[0, 0]];
    seen[0]![0] = true;
    while (stack.length) {
        const [r, c] = stack[stack.length - 1]!,
            aWay: [number, number, "h" | "v", number, number][] = [];
        if (r > 0 && !seen[r - 1]![c]) aWay.push([r - 1, c, "h", r, c]);
        if (r < rows - 1 && !seen[r + 1]![c]) aWay.push([r + 1, c, "h", r + 1, c]);
        if (c > 0 && !seen[r]![c - 1]) aWay.push([r, c - 1, "v", r, c]);
        if (c < cols - 1 && !seen[r]![c + 1]) aWay.push([r, c + 1, "v", r, c + 1]);

        if (!aWay.length) { stack.pop(); continue; }
        const [nr, nc, kind, wr, wc] = aWay[Math.floor(next() * aWay.length)]!;
        if (kind === "h") h[wr]![wc] = false; else v[wr]![wc] = false;
        link[id(r, c)]!.push(id(nr, nc));
        link[id(nr, nc)]!.push(id(r, c));
        seen[nr]![nc] = true;
        stack.push([nr, nc]);
    }

    return { cols, rows, h, v, link };
};

/** Cells with exactly one way out. */
const deadEnds = (g: Grid): number[] =>
    g.link.map((a, i) => (a.length === 1 ? i : -1)).filter(i => i >= 0);

/** Open some dead ends into loops. */
const braid = (g: Grid, amount: number, next: () => number): void => {
    const aDead = deadEnds(g);
    for (const i of aDead) {
        if (next() > amount) continue;
        const r = Math.floor(i / g.cols),
            c = i % g.cols,
            // Only a wall with a cell on the other side: knocking one out of
            // the border would make a second way in.
            aWall: ["h" | "v", number, number, number][] = [];
        if (r > 0 && g.h[r]![c]) aWall.push(["h", r, c, (r - 1) * g.cols + c]);
        if (r < g.rows - 1 && g.h[r + 1]![c]) aWall.push(["h", r + 1, c, (r + 1) * g.cols + c]);
        if (c > 0 && g.v[r]![c]) aWall.push(["v", r, c, r * g.cols + c - 1]);
        if (c < g.cols - 1 && g.v[r]![c + 1]) aWall.push(["v", r, c + 1, r * g.cols + c + 1]);
        if (!aWall.length) continue;

        const [kind, wr, wc, other] = aWall[Math.floor(next() * aWall.length)]!;
        if (kind === "h") g.h[wr]![wc] = false; else g.v[wr]![wc] = false;
        g.link[i]!.push(other);
        g.link[other]!.push(i);
    }
};

/** The shortest way from one cell to another, as cell indices. */
const solve = (g: Grid, from: number, to: number): number[] => {
    const prev = new Map<number, number>([[from, -1]]),
        queue = [from];
    for (let i = 0; i < queue.length; i++) {
        const at = queue[i]!;
        if (at === to) break;
        for (const nx of g.link[at]!) {
            if (prev.has(nx)) continue;
            prev.set(nx, at);
            queue.push(nx);
        }
    }
    if (!prev.has(to)) return [];
    const out: number[] = [];
    for (let at = to; at !== -1; at = prev.get(at)!) out.push(at);
    return out.reverse();
};

/**
 * A row of collinear wall segments as one polyline each.
 *
 * `at` is the fixed coordinate of the line, `aOn` says which of the segments
 * along it exist, and `step` is how long one is.
 */
const mergeRun = (aOn: boolean[], at: number, step: number, bHorizontal: boolean, origin: Point): Point[][] => {
    const out: Point[][] = [];
    let start = -1;
    for (let i = 0; i <= aOn.length; i++) {
        const on = i < aOn.length && aOn[i]!;
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
            const a = origin.x + (bHorizontal ? start * step : at),
                b = origin.y + (bHorizontal ? at : start * step),
                c = origin.x + (bHorizontal ? i * step : at),
                d = origin.y + (bHorizontal ? at : i * step);
            out.push([{ x: a, y: b }, { x: c, y: d }]);
            start = -1;
        }
    }
    return out;
};

export const buildMaze = (opt: MazeOptions): MazeResult => {
    const L = MAZE_LIMITS,
        warnings: string[] = [],
        cols = Math.round(clamp(opt.cols, L.minCells, L.maxCells)),
        rows = Math.round(clamp(opt.rows, L.minCells, L.maxCells)),
        cell = clamp(opt.cell, L.minCell, L.maxCell),
        border = clamp(opt.border, 0, L.maxBorder),
        next = rng(opt.seed);

    const g = carve(cols, rows, next);
    if (opt.braid > 0) braid(g, clamp(opt.braid, 0, 1), next);

    // ── the way in and the way out ──────────────────────────────────────
    let from = 0,
        to = rows * cols - 1;
    if (opt.ends === "corners") {
        g.v[0]![0] = false;
        g.v[rows - 1]![cols] = false;
    } else if (opt.ends === "sides") {
        const a = Math.floor(rows / 2);
        g.v[a]![0] = false;
        g.v[a]![cols] = false;
        from = a * cols;
        to = a * cols + cols - 1;
    } else if (opt.ends === "topBottom") {
        const a = Math.floor(cols / 2);
        g.h[0]![a] = false;
        g.h[rows]![a] = false;
        from = a;
        to = (rows - 1) * cols + a;
    }

    // ── the walls, merged ───────────────────────────────────────────────
    const origin: Point = { x: border, y: border },
        aWall: Point[][] = [];
    let segments = 0;

    for (let r = 0; r <= rows; r++) {
        segments += g.h[r]!.filter(Boolean).length;
        aWall.push(...mergeRun(g.h[r]!, r * cell, cell, true, origin));
    }
    for (let c = 0; c <= cols; c++) {
        const column = Array.from({ length: rows }, (_, r) => g.v[r]![c]!);
        segments += column.filter(Boolean).length;
        aWall.push(...mergeRun(column, c * cell, cell, false, origin));
    }

    const width = cols * cell + 2 * border,
        height = rows * cell + 2 * border,
        outline = opt.outline ? [rectRing({ x0: 0, y0: 0, x1: width, y1: height }, 0)] : [];

    // ── the way through ─────────────────────────────────────────────────
    const centre = (i: number): Point => ({
        x: origin.x + ((i % cols) + 0.5) * cell,
        y: origin.y + (Math.floor(i / cols) + 0.5) * cell
    });
    const aPath = opt.ends === "none" ? [] : solve(g, from, to),
        solution = aPath.map(centre);

    // ── sanity ──────────────────────────────────────────────────────────
    if (cell < 3) {
        warnings.push(
            `A ${r3(cell)} mm corridor is narrower than most engraved lines are forgiving of — the walls will run `
            + "into each other and the maze will read as a grey block."
        );
    }
    if (cols * rows > 6000) {
        warnings.push(`${cols * rows} cells is a long job and a maze nobody will finish. It will engrave, but check the time first.`);
    }
    if (opt.braid > 0) {
        warnings.push(
            `Braiding has opened ${Math.round(clamp(opt.braid, 0, 1) * 100)} % of the dead ends into loops. It looks `
            + "harder and solves easier: you can no longer be sure a corridor you have not tried is worth trying."
        );
    }
    if (opt.ends === "none") {
        warnings.push("With no way in and no way out this is a pattern rather than a maze.");
    }
    if (!opt.outline) {
        warnings.push("The border is not being cut, so what comes out is the walls alone — engrave it onto something that is already the right size.");
    }

    // ── the drawing ─────────────────────────────────────────────────────
    const aLayer: MazeLayer[] = [
        ...(outline.length ? [{ operation: CUT, rings: outline }] : []),
        { operation: MARK, rings: aWall, open: true }
    ];

    const body = aLayer.map(l =>
        `<path d="${l.rings.map(a => pathData(a, !l.open)).join(" ")}" fill="none" stroke="${l.operation.css}"`
        + ` stroke-width="${EXPORT_STROKE}" stroke-linecap="square"/>`).join("");

    const engraveLength = aWall.reduce((n, a) => n + Math.hypot(a[1]!.x - a[0]!.x, a[1]!.y - a[0]!.y), 0);

    return {
        preview: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(width)}mm" height="${r3(height)}mm"`
            + ` viewBox="0 0 ${r3(width)} ${r3(height)}">${body}</svg>`,
        aLayer,
        width,
        height,
        solution,
        cells: cols * rows,
        walls: aWall.length,
        segments,
        deadEnds: deadEnds(g).length,
        solutionLength: aPath.length,
        engraveLength,
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const mazeToSvg = (r: MazeResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + r.aLayer.map(l =>
        `<path d="${l.rings.map(a => pathData(a, !l.open)).join(" ")}" fill="none"`
        + ` stroke="${l.operation.css}" stroke-width="${EXPORT_STROKE}"/>`).join("")
    + "</svg>";

export const mazeToDxf = (r: MazeResult): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.rings.map(a => ({
            color: l.operation.color,
            closed: !l.open,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const mazeToFds = (r: MazeResult): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: l.operation === CUT ? 2 : 1,
        subpaths: l.rings.map(a => ({ points: a, closed: !l.open }))
    })));
