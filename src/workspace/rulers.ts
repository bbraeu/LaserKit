// ---------------------------------------------------------------------------
// The millimetre rulers and the grid behind the drawing.
//
// Both answer the same question — "how big is this, really?" — which a laser
// preview has to answer at a glance, because the number that matters is not
// pixels on a screen but millimetres of material. So the spacing is never a
// fixed pixel size: it is chosen from the 1–2–5 ladder so that one square is
// always a round number of millimetres at the current zoom, and the labels are
// values you could read off a steel rule.
//
// Everything here is pure but for the two draw calls, which take a canvas — so
// the arithmetic that decides the spacing is unit-tested on its own.
// ---------------------------------------------------------------------------

export interface RulerView {
    /** the visible range in millimetres */
    x: number;
    y: number;
    w: number;
    h: number;
    pxPerMm: number;
}

/** The smallest 1–2–5 step whose on-screen size is at least `minPx`. */
export const niceStep = (minPx: number, pxPerMm: number): number => {
    if (!(pxPerMm > 0) || !isFinite(pxPerMm)) return 1;
    const need = minPx / pxPerMm;
    if (!(need > 0)) return 1;
    const pow = 10 ** Math.floor(Math.log10(need));
    for (const m of [1, 2, 5]) {
        if (pow * m >= need) return pow * m;
    }
    return pow * 10;
};

/** Grid spacing in millimetres: a fine square, and a heavier one every five. */
export const gridSteps = (pxPerMm: number): { minor: number; major: number } => {
    const minor = niceStep(9, pxPerMm);
    return { minor, major: minor * 5 };
};

/** Tick spacing for a ruler: a labelled step, and four unlabelled between. */
export const rulerSteps = (pxPerMm: number): { minor: number; major: number } => {
    const major = niceStep(64, pxPerMm);
    return { minor: major / 5, major };
};

/** Millimetres printed the way a workshop writes them: 0, 5, 10, 12.5. */
export const formatMm = (n: number): string => {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? String(r) : String(r);
};

/** Where a rotated label's baseline sits across a vertical ruler, in px. */
const LABEL_INSET = 11;

const RULER_BG = "#0e1016";
const RULER_LINE = "rgba(255,255,255,0.16)";
const RULER_TEXT = "#878da0";
const RULER_EDGE = "rgba(255,255,255,0.07)";

/**
 * Draw one ruler. `horizontal` picks the axis; the canvas is expected to be the
 * full length of the stage on that axis and RULER_PX thick on the other.
 */
export const drawRuler = (
    canvas: HTMLCanvasElement,
    view: RulerView,
    horizontal: boolean
): void => {
    const dpr = Math.min(3, (globalThis.devicePixelRatio ?? 1) || 1),
        cssLen = horizontal ? canvas.clientWidth : canvas.clientHeight,
        cssThick = horizontal ? canvas.clientHeight : canvas.clientWidth;
    if (!cssLen || !cssThick) return;

    const wPx = Math.round((horizontal ? cssLen : cssThick) * dpr),
        hPx = Math.round((horizontal ? cssThick : cssLen) * dpr);
    if (canvas.width !== wPx) canvas.width = wPx;
    if (canvas.height !== hPx) canvas.height = hPx;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssLen, cssThick);
    ctx.fillStyle = RULER_BG;
    ctx.fillRect(0, 0, horizontal ? cssLen : cssThick, horizontal ? cssThick : cssLen);

    // The inner edge, so the ruler reads as a frame around the paper.
    ctx.fillStyle = RULER_EDGE;
    if (horizontal) ctx.fillRect(0, cssThick - 1, cssLen, 1);
    else ctx.fillRect(cssThick - 1, 0, 1, cssLen);

    const { minor, major } = rulerSteps(view.pxPerMm),
        from = horizontal ? view.x : view.y,
        span = horizontal ? view.w : view.h,
        to = from + span;

    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = RULER_TEXT;
    ctx.strokeStyle = RULER_LINE;
    ctx.lineWidth = 1;
    ctx.textBaseline = horizontal ? "top" : "alphabetic";

    // Guard against a pathological view producing a million ticks.
    if (!(minor > 0) || span / minor > 5000) return;

    const first = Math.floor(from / minor) * minor;
    ctx.beginPath();
    for (let mm = first; mm <= to; mm += minor) {
        const p = Math.round((mm - from) * view.pxPerMm) + 0.5;
        if (p < 0 || p > cssLen) continue;
        // Floating point: 12.499999 must still count as a major tick.
        const bMajor = Math.abs(mm / major - Math.round(mm / major)) < 1e-6,
            len = bMajor ? cssThick : cssThick * 0.4;
        if (horizontal) {
            ctx.moveTo(p, cssThick - len);
            ctx.lineTo(p, cssThick);
        } else {
            ctx.moveTo(cssThick - len, p);
            ctx.lineTo(cssThick, p);
        }
        if (bMajor) {
            const s = formatMm(mm);
            if (horizontal) ctx.fillText(s, p + 2.5, 2);
            else {
                // Rotating by −90° maps the glyphs' *ascenders* onto negative x,
                // so a baseline at x = 2 would draw most of the number off the
                // left edge of a 20 px strip. Sit it a font's height in instead.
                ctx.save();
                ctx.translate(LABEL_INSET, p - 3);
                ctx.rotate(-Math.PI / 2);
                ctx.fillText(s, 0, 0);
                ctx.restore();
            }
        }
    }
    ctx.stroke();
};
