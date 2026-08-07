import { pathData, r3, rectRing } from "./design";
import { OPERATION_COLORS, buildDxf, parsePathToPolylines } from "./dxf";
import type { DxfEntity, Point } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Jigsaw puzzles.
//
// A jigsaw is a grid of pieces whose edges interlock, and the whole thing rests
// on one shape: the knob. Get that wrong and you have a grid of squares with
// bumps on, which fall apart the moment the puzzle is lifted. What makes a
// jigsaw hold together is that the knob's *neck is narrower than its head* — a
// piece cannot be pulled straight out of its neighbour, only lifted away from
// the plane. So the profile here is the classic seven-cubic curve with a real
// undercut, and the jitter that makes each piece different never touches the
// neck.
//
// Everything else follows from two facts about cutting one rather than printing
// one:
//
// *An edge is cut once.* A piece and its neighbour share it, so the tab is
// generated per *edge* rather than per piece — cutting each piece's whole
// outline would send the beam down every internal line twice, doubling the job
// and burning the joint loose.
//
// *The kerf is the fit.* The beam takes its own width out of the joint, so the
// pieces come out of the sheet already loose by one kerf and there is nothing
// to compensate: tightening the cut by half a kerf on each side would weld the
// pieces to each other. What the tool can do is say so.
// ---------------------------------------------------------------------------

const CUT = OPERATION_COLORS.VECTOR_CUTTING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

/** Chord tolerance the knob's curves are flattened to, in mm. */
const FLATTEN = 0.05;

export const PUZZLE_LIMITS = {
    minPieces: 2,
    maxPieces: 40,
    minSize: 20,
    maxSize: 1200,
    maxRadius: 60
} as const;

export interface PuzzleOptions {
    width: number;
    height: number;
    /** pieces across and down */
    cols: number;
    rows: number;
    /**
     * How different the pieces are from each other, 0…1.
     *
     * This is the difficulty. At 0 it is a perfect lattice of identical pieces
     * — a handsome object and a broken puzzle, because every piece fits every
     * socket and there is nothing to work out. Raising it moves three things at
     * once, and it takes all three to make pieces that genuinely argue:
     *
     *   · the corners of the lattice wander, so the pieces are different
     *     *sizes* and the joints are no longer straight lines;
     *   · each knob slides along its own edge;
     *   · each knob is a different size.
     *
     * What it never touches is the neck. Where a knob sits and how big it is
     * are difficulty; whether it locks is not negotiable.
     */
    difficulty: number;
    /** knob size as a fraction of the shorter side of a piece, 0.1…0.35 */
    knob: number;
    /** rounded outer corners, mm */
    radius: number;
    /** what makes this puzzle this puzzle */
    seed: number;
    /** cut the outer border as well as the joints */
    outline: boolean;
}

export interface PuzzleResult {
    preview: string;
    /** the joints: open lines, each cut once */
    joints: Point[][];
    /** the border, when it is being cut */
    outline: Point[][];
    width: number;
    height: number;
    pieces: number;
    /** the average piece, mm — they differ once the difficulty is up */
    pieceW: number;
    pieceH: number;
    /** the largest and smallest piece as a fraction of the average */
    spread: number;
    /** how far the head travels cutting, mm */
    cutLength: number;
    points: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 10) / 10} mm`;

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
 * The knob, as cubic control points along a unit edge.
 *
 * `x` runs 0…1 from one corner of the edge to the other; `y` stands out of it,
 * positive on the tab side. The waist at x ≈ 0.42 and x ≈ 0.58 is narrower than
 * the head that follows it, and that undercut is the entire reason a jigsaw
 * holds together — a piece can be lifted out of the plane but not pulled out
 * sideways. Every number here is a fraction of the edge, so the profile is the
 * same shape at any piece size.
 */
const KNOB: [number, number, number, number, number, number][] = [
    // c1x, c1y, c2x, c2y, x, y — each relative to the edge, ending at the next
    // point. y is normalised so the *head* sits at 1: the knob then stands out
    // by exactly the size asked for, rather than by whatever fraction of it the
    // profile happened to be drawn at.
    [0.20, 0.00, 0.32, 0.12, 0.37, 0.12],   // out to the shoulder
    [0.45, 0.12, 0.42, 0.00, 0.38, -0.28],  // in to the neck, crossing the line
    [0.33, -0.66, 0.19, -1.00, 0.50, -1.00],// and out to the head
    [0.81, -1.00, 0.67, -0.66, 0.62, -0.28],// back through the far neck
    [0.58, 0.00, 0.55, 0.12, 0.63, 0.12],   // the far shoulder
    [0.68, 0.12, 0.80, 0.00, 1.00, 0.00]
];

/**
 * The lattice the pieces are cut on: every corner of every piece.
 *
 * Moving these is what makes pieces different *sizes*, and it is the single
 * biggest thing separating a jigsaw from a waffle. Both joints that meet at a
 * corner read it from here, so however far it has wandered they still meet
 * exactly.
 *
 * A corner of the board cannot move at all, and a vertex on an edge of the
 * board may only slide *along* that edge — otherwise the board stops being the
 * rectangle it was asked for.
 */
const lattice = (
    cols: number,
    rows: number,
    pieceW: number,
    pieceH: number,
    wobble: number,
    next: () => number
): Point[][] =>
    Array.from({ length: rows + 1 }, (_, r) =>
        Array.from({ length: cols + 1 }, (_, c) => {
            const bSideX = c === 0 || c === cols,
                bSideY = r === 0 || r === rows;
            return {
                x: c * pieceW + (bSideX ? 0 : (next() - 0.5) * 2 * wobble * pieceW),
                y: r * pieceH + (bSideY ? 0 : (next() - 0.5) * 2 * wobble * pieceH)
            };
        }));

/**
 * One edge of one piece, as a flattened polyline.
 *
 * The edge runs from `a` to `b`; `out` is which side the knob sticks out of,
 * and `shift` slides it along the edge without touching the waist.
 */
const edgePath = (a: Point, b: Point, knob: number, out: number, shift: number): Point[] => {
    const dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy) || 1,
        // Out of the edge, and a *unit* vector: leaving it the length of the
        // edge would scale the knob with the piece twice over, and on a 40 mm
        // piece put the tip of it well outside the sheet.
        px = -dy / len,
        py = dx / len,
        k = knob * out;

    /** A point of the profile placed in the world. */
    const put = (t: number, o: number): string => {
        const s = t + shift * (t > 0.02 && t < 0.98 ? 1 : 0);
        return `${r3(a.x + dx * s + px * o * k)} ${r3(a.y + dy * s + py * o * k)}`;
    };

    let d = `M${put(0, 0)}`;
    for (const [c1x, c1y, c2x, c2y, x, y] of KNOB) {
        d += ` C${put(c1x, c1y)} ${put(c2x, c2y)} ${put(x, y)}`;
    }
    // Flattened by the same code the SVG importer uses, so a curve cut here and
    // a curve read back in are the same polyline.
    const aSub = parsePathToPolylines(d, FLATTEN);
    return aSub[0]?.points ?? [a, b];
};

export const buildPuzzle = (opt: PuzzleOptions): PuzzleResult => {
    const L = PUZZLE_LIMITS,
        warnings: string[] = [],
        W = clamp(opt.width, L.minSize, L.maxSize),
        H = clamp(opt.height, L.minSize, L.maxSize),
        cols = Math.round(clamp(opt.cols, L.minPieces, L.maxPieces)),
        rows = Math.round(clamp(opt.rows, L.minPieces, L.maxPieces)),
        pieceW = W / cols,
        pieceH = H / rows,
        hard = clamp(opt.difficulty, 0, 1),
        // Of the shorter side, so a long thin piece does not get a knob taller
        // than the piece is wide.
        knob = clamp(opt.knob, 0.1, 0.35) * Math.min(pieceW, pieceH),
        next = rng(opt.seed);

    // How far each of the three things may move at this difficulty. The corner
    // wander is deliberately the largest of them: a knob in a different place
    // is a detail, a piece of a different size is a different piece.
    const wobble = 0.22 * hard,
        slide = 0.20 * hard,
        vary = 0.70 * hard;

    const grid = lattice(cols, rows, pieceW, pieceH, wobble, next),
        joints: Point[][] = [];

    /** One joint between two lattice corners, with its own knob. */
    const joint = (a: Point, b: Point): void => {
        const len = Math.hypot(b.x - a.x, b.y - a.y),
            // Never more than a share of this edge's own length, so a knob on a
            // corner that has wandered close to its neighbour does not swallow
            // the piece between them.
            size = Math.min(knob * (1 + (next() - 0.5) * vary), len * 0.42);
        joints.push(edgePath(a, b, size, next() < 0.5 ? 1 : -1, (next() - 0.5) * slide));
    };

    // Vertical joints: between column c−1 and column c.
    for (let c = 1; c < cols; c++) {
        for (let r = 0; r < rows; r++) joint(grid[r]![c]!, grid[r + 1]![c]!);
    }
    // Horizontal joints: between row r−1 and row r.
    for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) joint(grid[r]![c]!, grid[r]![c + 1]!);
    }

    // What the wander did to the pieces, as one number for the panel: the
    // widest cell over the narrowest.
    let cellMin = Infinity,
        cellMax = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const w = grid[r]![c + 1]!.x - grid[r]![c]!.x,
                h = grid[r + 1]![c]!.y - grid[r]![c]!.y;
            cellMin = Math.min(cellMin, w * h);
            cellMax = Math.max(cellMax, w * h);
        }
    }

    const radius = clamp(opt.radius, 0, Math.min(L.maxRadius, Math.min(W, H) / 2)),
        outline = opt.outline ? [rectRing({ x0: 0, y0: 0, x1: W, y1: H }, radius)] : [];

    // ── sanity ──────────────────────────────────────────────────────────
    if (Math.min(pieceW, pieceH) < 12) {
        warnings.push(
            `Pieces of ${mm(pieceW)} × ${mm(pieceH)} are smaller than most fingers are patient with, and their knobs `
            + `come out ${mm(knob * 2)} across — thin enough to snap off as the puzzle is broken up.`
        );
    }
    if (hard === 0) {
        warnings.push(
            "At difficulty 0 every piece is the same shape, so every piece fits every socket. That is a lovely object "
            + "and a terrible puzzle."
        );
    }
    if (opt.knob > 0.3) {
        warnings.push("A knob this large leaves little of the piece that is not knob, and the necks come close to each other at the corners.");
    }
    if (radius > 0 && !opt.outline) {
        warnings.push("The corner radius does nothing while the border is not being cut.");
    }
    if (cols * rows > 400) {
        warnings.push(`${cols * rows} pieces is a long cut and a lot of very small parts. Check the time before you start it.`);
    }
    warnings.push(
        "The beam takes its own width out of every joint, so the pieces come out about one kerf loose — that is the "
        + "fit, and there is nothing to compensate. Cut a 2 × 2 test before a 500-piece sheet."
    );

    // ── the drawing ─────────────────────────────────────────────────────
    const all = [...outline.map(a => pathData(a)), ...joints.map(a => pathData(a, false))].join(" "),
        body = `<path d="${all}" fill="none" stroke="${CUT.css}" stroke-width="${EXPORT_STROKE}"`
            + ` stroke-linecap="round" stroke-linejoin="round"/>`;

    const cutLength = joints.reduce((n, a) => {
        let d = 0;
        for (let i = 1; i < a.length; i++) d += Math.hypot(a[i]!.x - a[i - 1]!.x, a[i]!.y - a[i - 1]!.y);
        return n + d;
    }, 0) + (opt.outline ? 2 * (W + H) : 0);

    return {
        preview: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(W)}mm" height="${r3(H)}mm"`
            + ` viewBox="0 0 ${r3(W)} ${r3(H)}">${body}</svg>`,
        joints,
        outline,
        width: W,
        height: H,
        pieces: cols * rows,
        pieceW,
        pieceH,
        spread: cellMin > 0 ? cellMax / cellMin : 1,
        cutLength,
        points: joints.reduce((n, a) => n + a.length, 0) + outline.reduce((n, a) => n + a.length, 0),
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
//
// A joint is an open line and is cut once: it belongs to both of the pieces it
// separates, and sending the beam down it twice would burn the fit loose.
// ---------------------------------------------------------------------------

const paths = (r: PuzzleResult): { ring: Point[]; closed: boolean }[] => [
    ...r.outline.map(a => ({ ring: a, closed: true })),
    ...r.joints.map(a => ({ ring: a, closed: false }))
];

export const puzzleToSvg = (r: PuzzleResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + paths(r).map(o => `<path d="${pathData(o.ring, o.closed)}" fill="none" stroke="${CUT.css}"`
        + ` stroke-width="${EXPORT_STROKE}"/>`).join("")
    + "</svg>";

export const puzzleToDxf = (r: PuzzleResult): string => {
    const aEntity: DxfEntity[] = paths(r).map(o => ({
        color: CUT.color,
        closed: o.closed,
        // SVG y grows downward, DXF y grows upward.
        points: o.ring.map(p => ({ x: p.x, y: r.height - p.y }))
    }));
    return buildDxf(aEntity);
};

export const puzzleToFds = (r: PuzzleResult): Promise<Blob> =>
    buildFds([{
        mode: 2,
        subpaths: paths(r).map(o => ({ points: o.ring, closed: o.closed }))
    }]);
