import qrcode from "qrcode-generator";
import { pathData, r3, rectRing } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Operation, Point } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// QR codes as geometry.
//
// The encoding is not written here, deliberately. A QR code that is wrong does
// not look wrong — it looks like a QR code and simply refuses to scan, and the
// only honest way to prove one is right is to decode it. Chromium on Windows
// has no BarcodeDetector, so this project cannot decode one in its own tests;
// writing Reed-Solomon, mask selection and the version tables here would mean
// shipping several hundred lines whose correctness nothing in the repository
// could check. `qrcode-generator` is twenty years old, has no dependencies of
// its own and hands back the raw module matrix, which is exactly the seam
// wanted: it answers "which squares are dark", and everything below is about
// turning squares into something a laser can cut.
//
// Two decisions matter for the geometry, and both are about what a laser does
// that a printer does not.
//
// *Adjacent modules are merged.* A 33 × 33 code is a thousand little squares;
// engraved as a thousand separate rectangles the head spends most of the job
// travelling. Runs of dark modules along a row become one rectangle, which is
// the same burnt area in a fraction of the moves.
//
// *A cut-out code needs its islands held.* Cut the dark modules out of a plate
// and every enclosed light region — the middle of a finder pattern, most of the
// quiet areas — falls on the floor. So cutting is offered only as an inlay
// (dark modules as loose tiles to drop into a light plate), and the tool says
// which of those pieces will be loose.
// ---------------------------------------------------------------------------

const FILL = OPERATION_COLORS.FILL_VECTOR_ENGRAVING!;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

export const QR_LIMITS = {
    minSize: 10,
    maxSize: 1000,
    maxQuiet: 16,
    // Above what any QR code holds: a version 40 at the lowest error correction
    // takes 2 953 bytes. The cap is a guard against pasting a novel in, not a
    // second opinion on capacity — the encoder is the authority on that, and it
    // is allowed to say no.
    maxChars: 3000
} as const;

/**
 * How much damage the code can take and still read.
 *
 * Not a quality setting: it is redundancy, and it costs modules. On a laser the
 * argument for a high level is different from the printed one — a scorched or
 * chipped engraving is exactly the damage this recovers from.
 */
export type QrEcc = "L" | "M" | "Q" | "H";

/** Engraved as filled squares, or cut as tiles to inlay. */
export type QrMode = "engrave" | "inlay";

export interface QrOptions {
    text: string;
    ecc: QrEcc;
    mode: QrMode;
    /** the whole code including its quiet border, mm */
    size: number;
    /** light border around the code, in modules — the spec asks for four */
    quiet: number;
    /** shrink each dark module by this on every side, mm */
    trim: number;
    /** cut the plate's own outline */
    outline: boolean;
    /** rounded plate corners, mm */
    radius: number;
}

export interface QrLayer {
    operation: Operation;
    rings: Point[][];
    filled: boolean;
}

export interface QrResult {
    preview: string;
    aLayer: QrLayer[];
    width: number;
    height: number;
    /** QR version, 1…40 — the module count is 4·version + 17 */
    version: number;
    /** modules across, before the quiet border */
    modules: number;
    /** one module, mm */
    moduleSize: number;
    /** dark modules, and the rectangles they were merged into */
    dark: number;
    rects: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 100) / 100} mm`;

/**
 * Runs of dark modules along each row, as rectangles.
 *
 * Only along rows, not a full rectangle decomposition: merging in two
 * directions would need a proper partition and buys little here, because a QR
 * code's dark regions are mostly one or two modules tall. One pass down the
 * rows takes a thousand squares to a few hundred rectangles, which is where the
 * saving is.
 */
const mergeRows = (dark: (r: number, c: number) => boolean, n: number): { r: number; c0: number; c1: number }[] => {
    const out: { r: number; c0: number; c1: number }[] = [];
    for (let r = 0; r < n; r++) {
        let c0 = -1;
        for (let c = 0; c <= n; c++) {
            const on = c < n && dark(r, c);
            if (on && c0 < 0) c0 = c;
            if (!on && c0 >= 0) {
                out.push({ r, c0, c1: c });
                c0 = -1;
            }
        }
    }
    return out;
};

export const buildQr = (opt: QrOptions): QrResult => {
    const L = QR_LIMITS,
        warnings: string[] = [],
        text = opt.text.slice(0, L.maxChars),
        size = clamp(opt.size, L.minSize, L.maxSize),
        quiet = Math.round(clamp(opt.quiet, 0, L.maxQuiet)),
        trim = Math.max(0, opt.trim);

    if (!text.trim()) throw new Error("Type something for the code to carry.");

    // Version 0 asks the encoder to pick the smallest version the data fits.
    const qr = qrcode(0, opt.ecc);
    qr.addData(text);
    try {
        qr.make();
    } catch {
        throw new Error(
            `That is too much data for a QR code at error correction ${opt.ecc}. Shorten it, or drop to a lower level.`
        );
    }

    const modules = qr.getModuleCount(),
        version = (modules - 17) / 4,
        span = modules + 2 * quiet,
        moduleSize = size / span,
        dark = (r: number, c: number): boolean => qr.isDark(r, c);

    // ── the modules, merged along their rows ────────────────────────────
    const aRun = mergeRows(dark, modules),
        rings: Point[][] = aRun.map(o => rectRing({
            x0: (quiet + o.c0) * moduleSize + trim,
            y0: (quiet + o.r) * moduleSize + trim,
            x1: (quiet + o.c1) * moduleSize - trim,
            y1: (quiet + o.r + 1) * moduleSize - trim
        }, 0));

    let nDark = 0;
    for (let r = 0; r < modules; r++) {
        for (let c = 0; c < modules; c++) if (dark(r, c)) nDark++;
    }

    // ── sanity ──────────────────────────────────────────────────────────
    if (moduleSize < 0.6) {
        warnings.push(
            `Each module is ${mm(moduleSize)} across. Under about 0.6 mm the beam's own width is a large fraction of `
            + "a square and the code stops scanning — make it bigger, or carry less in it."
        );
    }
    if (quiet < 4) {
        warnings.push(
            `The spec asks for a quiet border of four modules and this has ${quiet}. Readers do fail without it, `
            + "especially against a busy background."
        );
    }
    if (trim >= moduleSize / 2) {
        warnings.push(`Trimming ${mm(trim)} off every side leaves nothing of a ${mm(moduleSize)} module.`);
    } else if (trim > 0 && opt.mode === "engrave") {
        warnings.push(
            "Trim is for cutting, where the beam takes material off every tile. Engraving already burns inside the "
            + "line, so trimming here only makes the dark squares smaller than the code expects."
        );
    }
    if (opt.mode === "inlay") {
        warnings.push(
            `${aRun.length} dark pieces come off the bed loose, and they are not interchangeable — a QR code is not `
            + "symmetrical. Cut the light plate as a pocket, or engrave instead."
        );
    }
    if (version >= 10) {
        warnings.push(
            `This is a version ${version} code (${modules} × ${modules} modules). A long URL makes a dense code; a `
            + "link shortener makes a code somebody's phone can actually catch."
        );
    }

    // ── layers ──────────────────────────────────────────────────────────
    const plate = opt.outline
        ? [rectRing({ x0: 0, y0: 0, x1: size, y1: size }, clamp(opt.radius, 0, size / 2))]
        : [];

    const aLayer: QrLayer[] = [
        ...(plate.length ? [{ operation: CUT, rings: plate, filled: false }] : []),
        opt.mode === "inlay"
            ? { operation: CUT, rings, filled: false }
            : { operation: FILL, rings, filled: true }
    ];

    return {
        preview: svgOf(aLayer, size),
        aLayer,
        width: size,
        height: size,
        version,
        modules,
        moduleSize,
        dark: nDark,
        rects: aRun.length,
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const svgOf = (aLayer: QrLayer[], size: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(size)}mm" height="${r3(size)}mm"`
    + ` viewBox="0 0 ${r3(size)} ${r3(size)}">`
    + aLayer.map(l => {
        const d = l.rings.map(a => pathData(a)).join(" ");
        return l.filled
            ? `<path d="${d}" fill="${l.operation.css}"/>`
            : `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="${EXPORT_STROKE}"/>`;
    }).join("")
    + "</svg>";

export const qrToSvg = (r: QrResult): string => svgOf(r.aLayer, r.width);

export const qrToDxf = (r: QrResult): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.rings.map(a => ({
            color: l.operation.color,
            closed: true,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const qrToFds = (r: QrResult): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: l.filled ? 0 : 2,
        subpaths: l.rings.map(a => ({ points: a, closed: true }))
    })));
