import { pathData, r3, rectRing, shelfPack, subBounds } from "./design";
import type { DesignDoc } from "./design";
import { DEFAULT_OPERATION, OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Operation, Point, Subpath } from "./dxf";
import { buildFds, getFdsModeFor } from "./fds";

// ---------------------------------------------------------------------------
// Nesting: the same design, as many times as fit.
//
// Two things about this tool are worth saying out loud, because both are the
// kind of thing a nesting tool usually hides.
//
// **It packs bounding boxes, in rows.** Real nesting — sliding one outline into
// the concavity of another, turning each part to whatever angle wastes least —
// is NP-hard, and every honest implementation of it is a solver that runs for
// minutes and still cannot promise it found the best answer. What is here is
// what a person does by hand: put them in rows. For the parts a laser actually
// cuts, that lands within a few per cent of a hand layout, and it is instant.
// Where it is bad — a big L-shaped part, a crescent — it is *visibly* bad on
// the canvas rather than quietly bad in the file.
//
// **It keeps the operations.** A design read back in carries what its colours
// said to do with it: engraving stays engraving, cutting stays cutting. This
// sounds obvious and is the whole reason to have the tool at all rather than
// copy-pasting in a laser program — twenty copies of a keychain whose lettering
// has become a cut line is twenty ruined blanks, and the mistake is invisible
// until the sheet is on the bed.
// ---------------------------------------------------------------------------

const CUT = OPERATION_COLORS.VECTOR_CUTTING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

export const NEST_LIMITS = {
    minSheet: 20,
    maxSheet: 3000,
    maxCopies: 2000,
    maxGap: 100,
    maxMargin: 200
} as const;

/** Ask for a number of copies, or for as many as the sheet will hold. */
export type NestMode = "count" | "fill";

export interface NestOptions {
    mode: NestMode;
    /** how many, when that is the question */
    copies: number;

    sheetWidth: number;
    sheetHeight: number;
    /** unburnt material between two copies */
    gap: number;
    /** kept clear all round the sheet — clamps, and the bed's own edge */
    margin: number;

    /**
     * Lay the design on its side if more of it fits that way.
     *
     * All the copies turn together or none of them do: every copy is the same
     * shape, so mixing orientations packs no tighter and only makes the grain
     * run two ways.
     */
    rotate: boolean;
}

export interface NestLayer {
    operation: Operation;
    subpaths: Subpath[];
}

export interface NestResult {
    preview: string;
    aLayer: NestLayer[];
    /** the sheet, which is what the drawing is sized to */
    width: number;
    height: number;

    /** copies actually laid down */
    placed: number;
    /** how many fit on one sheet at these settings */
    perSheet: number;
    /** sheets needed for the number asked for */
    sheets: number;
    columns: number;
    rows: number;
    /** the design's own size, mm, in the orientation used */
    itemW: number;
    itemH: number;
    turned: boolean;
    /** how much of the sheet the designs' boxes cover, 0…1 */
    usage: number;
    points: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 10) / 10} mm`;

/** The design turned a quarter turn about its own top-left corner. */
const turnSub = (aSub: Subpath[], h: number): Subpath[] =>
    aSub.map(sub => ({
        ...sub,
        points: sub.points.map(p => ({ x: h - p.y, y: p.x }))
    }));

/**
 * How many copies of a `w × h` box fit in a `W × H` field laid out in rows.
 *
 * Counted rather than packed, because the answer is needed twice before
 * anything is placed: once for each orientation, to decide which way round to
 * lay the design out at all.
 */
const capacity = (W: number, H: number, w: number, h: number, gap: number): { cols: number; rows: number } => {
    if (w <= 0 || h <= 0 || W < w || H < h) return { cols: 0, rows: 0 };
    return {
        cols: Math.max(0, Math.floor((W + gap) / (w + gap))),
        rows: Math.max(0, Math.floor((H + gap) / (h + gap)))
    };
};

export const buildNest = (doc: DesignDoc, opt: NestOptions): NestResult => {
    const L = NEST_LIMITS,
        warnings: string[] = [],
        sheetW = clamp(opt.sheetWidth, L.minSheet, L.maxSheet),
        sheetH = clamp(opt.sheetHeight, L.minSheet, L.maxSheet),
        gap = clamp(opt.gap, 0, L.maxGap),
        margin = clamp(opt.margin, 0, L.maxMargin),
        fieldW = Math.max(0, sheetW - 2 * margin),
        fieldH = Math.max(0, sheetH - 2 * margin);

    // The design at its own origin, so a copy is a translation and nothing else.
    const b = subBounds(doc.aSub),
        w0 = b.x1 - b.x0,
        h0 = b.y1 - b.y0,
        aAtOrigin: Subpath[] = doc.aSub.map(sub => ({
            ...sub,
            points: sub.points.map(p => ({ x: p.x - b.x0, y: p.y - b.y0 }))
        }));

    // ── which way round ─────────────────────────────────────────────────
    const flat = capacity(fieldW, fieldH, w0, h0, gap),
        side = opt.rotate ? capacity(fieldW, fieldH, h0, w0, gap) : { cols: 0, rows: 0 },
        nFlat = flat.cols * flat.rows,
        nSide = side.cols * side.rows,
        turned = nSide > nFlat,
        fit = turned ? side : flat,
        aItem = turned ? turnSub(aAtOrigin, h0) : aAtOrigin,
        itemW = turned ? h0 : w0,
        itemH = turned ? w0 : h0,
        perSheet = fit.cols * fit.rows;

    // ── how many to lay down ────────────────────────────────────────────
    const asked = Math.max(1, Math.round(clamp(opt.copies, 1, L.maxCopies))),
        placed = opt.mode === "fill" ? perSheet : Math.min(asked, Math.max(perSheet, 0) || asked),
        sheets = perSheet > 0 ? Math.ceil((opt.mode === "fill" ? perSheet : asked) / perSheet) : 0;

    const pack = shelfPack(
        Array.from({ length: placed }, () => ({ w: itemW, h: itemH })),
        // Constrained to the field rather than the sheet: the margin is not
        // packable space, it is the bit the clamps are standing on.
        Math.max(itemW, fieldW),
        gap
    );

    // ── copies, grouped by what the laser does with them ────────────────
    const byOp = new Map<Operation, Subpath[]>();
    pack.aPlaced.forEach(q => {
        const dx = margin + q.x,
            dy = margin + q.y;
        for (const sub of aItem) {
            const op = sub.operation ?? DEFAULT_OPERATION,
                a = byOp.get(op) ?? [];
            a.push({ ...sub, points: sub.points.map(p => ({ x: p.x + dx, y: p.y + dy })) });
            byOp.set(op, a);
        }
    });
    const aLayer: NestLayer[] = [...byOp.entries()].map(([operation, subpaths]) => ({ operation, subpaths }));

    // ── sanity ──────────────────────────────────────────────────────────
    if (perSheet === 0) {
        warnings.push(
            `The design is ${mm(w0)} × ${mm(h0)} and the space inside the margin is only ${mm(fieldW)} × ${mm(fieldH)} — `
            + "not one copy fits. Make the sheet bigger, the margin smaller, or scale the design first."
        );
    } else if (opt.mode === "count" && asked > perSheet) {
        warnings.push(
            `${asked} copies do not fit on one sheet: ${perSheet} do. The layout has run past the sheet — cut `
            + `${sheets} sheets, or drop to ${perSheet}.`
        );
    }
    if (aLayer.length === 1 && aLayer[0]!.operation === DEFAULT_OPERATION && doc.aSub.length > 0) {
        warnings.push(
            "This design's colours say nothing about what the laser should do, so every copy has come out on one "
            + "unnamed operation. Assign them in your laser software, or re-export the design from a tool that "
            + "colours them."
        );
    }
    if (gap === 0 && placed > 1) {
        warnings.push("With no gap the copies touch, so two cut lines fall on top of each other — the beam goes down the same slot twice and the edge scorches.");
    }
    warnings.push(...doc.warnings);

    // ── the drawing ─────────────────────────────────────────────────────
    const used = placed * itemW * itemH,
        body = aLayer.map(l => {
            const d = l.subpaths.map(sub => pathData(sub.points, sub.closed)).join(" ");
            return `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="${EXPORT_STROKE}"/>`;
        }).join("");

    // The sheet is drawn as a guide and is not in any export: it is where the
    // material is, not something to cut.
    const guide = `<rect x="0" y="0" width="${r3(sheetW)}" height="${r3(sheetH)}" fill="none"`
        + ` stroke="#7c8798" stroke-width="${r3(Math.max(0.2, sheetW / 800))}" stroke-dasharray="${r3(sheetW / 90)}"/>`
        + (margin > 0
            ? `<rect x="${r3(margin)}" y="${r3(margin)}" width="${r3(fieldW)}" height="${r3(fieldH)}" fill="none"`
                + ` stroke="#7c8798" stroke-opacity="0.45" stroke-width="${r3(Math.max(0.15, sheetW / 1200))}"`
                + ` stroke-dasharray="${r3(sheetW / 200)}"/>`
            : "");

    return {
        preview: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(sheetW)}mm" height="${r3(sheetH)}mm"`
            + ` viewBox="0 0 ${r3(sheetW)} ${r3(sheetH)}">${guide}${body}</svg>`,
        aLayer,
        width: sheetW,
        height: sheetH,
        placed,
        perSheet,
        sheets,
        columns: fit.cols,
        rows: fit.rows,
        itemW,
        itemH,
        turned,
        usage: sheetW * sheetH > 0 ? used / (sheetW * sheetH) : 0,
        points: aLayer.reduce((n, l) => n + l.subpaths.reduce((m, sub) => m + sub.points.length, 0), 0),
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
//
// The sheet outline is deliberately not in any of these. It is a guide to where
// the material is; cutting it would cut the material out of the material.
// ---------------------------------------------------------------------------

export const nestToSvg = (r: NestResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + r.aLayer.map(l =>
        `<path d="${l.subpaths.map(sub => pathData(sub.points, sub.closed)).join(" ")}" fill="none"`
        + ` stroke="${l.operation.css}" stroke-width="${EXPORT_STROKE}"/>`).join("")
    + "</svg>";

export const nestToDxf = (r: NestResult): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.subpaths.map(sub => ({
            color: l.operation.color,
            closed: sub.closed,
            // SVG y grows downward, DXF y grows upward.
            points: sub.points.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const nestToFds = (r: NestResult): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: getFdsModeFor(
            Object.keys(OPERATION_COLORS).find(k => OPERATION_COLORS[k] === l.operation)
        ),
        subpaths: l.subpaths
    })));

/** A rectangle the size of the sheet, for a tool that wants to show one. */
export const sheetRing = (r: NestResult): Point[] =>
    rectRing({ x0: 0, y0: 0, x1: r.width, y1: r.height }, 0);

/** The cut colour, for a legend that has no layers to read one off. */
export const NEST_CUT = CUT;
