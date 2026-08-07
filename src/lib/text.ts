import { circleRing, inRing, ringBounds, pathData, r3, simplifyRing, subBounds } from "./design";
import type { Box, DesignDoc } from "./design";
import { OPERATION_COLORS } from "./dxf";
import type { DxfEntity, Operation, Point, Subpath } from "./dxf";
import { buildDxf } from "./dxf";
import { buildFds } from "./fds";
import { cssFamily } from "./fonts";
import { buildOutline } from "./outline";
import type { ConnectMode } from "./outline";
import { buildTrace, prepareTrace } from "./trace";
import type { TraceImage } from "./trace";

// ---------------------------------------------------------------------------
// Text as cuttable geometry.
//
// The hard part is glyph outlines, and the browser will not hand them over: a
// canvas can *draw* text in any installed font but cannot say where its edges
// are, and an SVG <text> is a promise the importer has to keep, not a shape.
//
// So the text is drawn large onto a canvas and put through the image tracer
// this project already has. That buys three things a font parser would not:
// every font on the machine works without being uploaded, the browser's own
// shaper does the kerning and the ligatures, and the accuracy is the same
// figure the tracer already reports everywhere else. It costs precision — the
// outlines are fitted to a raster, not read from the font — which is why the
// render resolution is generous and the tolerance is in the status bar.
//
// From there it is all existing machinery: the traced glyphs are subpaths in
// millimetres, so `buildOutline` welds them into a backing plate exactly as it
// does for the contour tracer, and the keyring hole is one more ring.
// ---------------------------------------------------------------------------

const ENGRAVE = OPERATION_COLORS.FILL_VECTOR_ENGRAVING!;
const LINE = OPERATION_COLORS.VECTOR_ENGRAVING!;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

/**
 * Render resolution, expressed as the *capital's* height in pixels rather than
 * pixels per millimetre.
 *
 * The tracer's corner detection and its node reduction both work in pixels, so
 * a fixed px/mm would make a 6 mm keychain melt while a 60 mm sign came out
 * crisp — the quality would follow a number the user picked for a completely
 * different reason. Pinning the *glyph* to a constant pixel height instead
 * makes the fidelity the same at every size, and makes the pixel count depend
 * on how much text there is, which is the thing it should depend on.
 */
const RENDER_CAP_PX = 440;

/** The font size everything is measured at before being scaled to the real one. */
const NOMINAL_PX = 200;

/** Whitespace around the ink, so a trace never runs into the canvas edge. */
const PAD_PX = 6;

/** Beyond this the canvas is a memory problem rather than a drawing. */
const MAX_PX = 4200;

/** Speckle floor for the trace, in source pixels. */
const MIN_AREA_PX = 6;

/**
 * How coarsely the glyphs are handed to the plate tracer, in mm.
 *
 * The plate is an offset computed on a fine grid and it reports its own
 * tolerance — around 0.05 mm. Feeding it the full 4 000-point outline of a word
 * costs a third of a second per border nudge and changes the answer by nothing
 * at all, because the grid cannot resolve the difference. The *exported*
 * letters keep every point; only the plate's input is thinned.
 */
const PLATE_SIMPLIFY = 0.03;

/** Beyond this many characters, tracing each one apart is not worth the wait. */
const MAX_EDGE_GLYPHS = 120;

export type LetterMode = "engrave" | "cut" | "none";
export type RingEdge = "left" | "right" | "top" | "bottom";
export type TextAlign = "left" | "center" | "right";

export interface TextOptions {
    text: string;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    /** height of a capital letter, in mm */
    capHeight: number;
    /** extra space between letters, mm — negative tightens */
    letterSpacing: number;
    /** extra space between words, mm */
    wordSpacing: number;
    /** line pitch as a multiple of the cap height */
    lineHeight: number;
    align: TextAlign;
    /** 0…1.334, how much of a bend the tracer may round into a curve */
    smooth: number;
    /** node reduction tolerance, in render pixels */
    simplify: number;

    /** weld the letters into one piece to cut around */
    plate: boolean;
    /** millimetres of plate around the letters */
    border: number;
    /** join letters that still stand apart */
    connect: boolean;
    connectMode: ConnectMode;
    /** shrink-wrap reach in mm; 0 = whatever the gaps ask for */
    reach: number;

    /** what the laser does with the letters themselves */
    letters: LetterMode;
    /**
     * Engrave each letter's own edge on top.
     *
     * Tightened past touching, letters merge into one silhouette and the word
     * stops being readable — an "rn" becomes an "m". Tracing every glyph apart
     * puts the boundary back, and stacking them left to right keeps it honest:
     * a letter is engraved only where no later letter covers it, so what comes
     * out is what you would see if they were sheets of paper laid down in
     * reading order.
     */
    letterEdges: boolean;

    /** punch a hole to hang it from */
    ring: boolean;
    /** hole diameter, mm */
    ringDiameter: number;
    ringEdge: RingEdge;
    /** where along that edge, 0…100 */
    ringOffset: number;
    /** how far the hole's centre sits in from the edge, mm */
    ringInset: number;
    /**
     * Material kept around the hole.
     *
     * With a plate it is a lug: welded into the design before the outline is
     * traced, so the plate grows around a hole placed off the end of a word.
     * Without a plate it is the whole tab — the hole would otherwise be a lone
     * circle with nothing to cut it out of.
     */
    ringWall: number;
}

export interface TextLayer {
    operation: Operation;
    rings: Point[][];
    /** drawn filled in the preview and exported as an area, not a line */
    filled: boolean;
    /** open polylines rather than closed contours — a partly hidden letter edge */
    open?: boolean;
}

export interface TextResult {
    preview: string;
    aLayer: TextLayer[];
    width: number;
    height: number;
    /** glyph contours the tracer found */
    shapes: number;
    /** engraved overlap seams — 0 when no letter laps over another */
    edges: number;
    points: number;
    /** separate closed cut lines in the export */
    pieces: number;
    /** how far a traced edge may sit from the glyph it came from, mm */
    accuracy: number;
    /** the reach the gaps asked for, so the slider can start there */
    autoReach: number;
    /** the hole's centre in the finished piece's coordinates, for dragging it */
    ring: Point | null;
    /** what the hole is placed against — the plate, or the letters without one */
    ringBox: Box;
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Setting the text
// ---------------------------------------------------------------------------

interface Rendered {
    img: TraceImage;
    /** the canvas' own width in mm, which is what the trace is scaled by */
    widthMm: number;
    /** render pixels per millimetre, for placing separately traced glyphs */
    pxPerMm: number;
    fontPx: number;
    /** each character's pen position, already in the canvas' own coordinates */
    aPen: { ch: string; x: number; y: number }[];
}

interface Laid {
    fontPx: number;
    aOrigin: Point[];
    /** where each character's baseline starts, in canvas pixels */
    aPen: { ch: string; x: number; y: number }[];
    /** the ink box in canvas pixels */
    box: Box;
}

const fontShorthand = (o: TextOptions, px: number): string =>
    `${o.italic ? "italic " : ""}${o.bold ? 700 : 400} ${px}px ${cssFamily(o.fontFamily)}, sans-serif`;

/**
 * Draw the text at true size onto a canvas, ink-tight plus a little padding.
 *
 * The size the user asks for is the **cap height**, not the em size: "20 mm
 * letters" means the capitals are 20 mm whatever the font's internal metrics
 * are, and it does not change when a descender is typed. So the face is
 * measured once at a nominal size and scaled by what an "H" actually came out.
 */
const renderText = (o: TextOptions): Rendered | null => {
    const aLine = o.text.split("\n");
    if (!o.text.trim()) return null;

    const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser has no 2D canvas to set the text on.");

    ctx.font = fontShorthand(o, NOMINAL_PX);
    const capNominal = ctx.measureText("H").actualBoundingBoxAscent;
    if (!(capNominal > 0)) throw new Error("This font produced no glyphs to trace.");

    /** Lay the lines out at a given resolution and report the ink they cover. */
    const layOut = (pxPerMm: number): Laid => {
        const fontPx = (NOMINAL_PX * o.capHeight * pxPerMm) / capNominal;
        ctx.font = fontShorthand(o, fontPx);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        // Both are widely supported and degrade to 0 rather than throwing, which
        // is the right failure: the text is still set, just without the tracking.
        ctx.letterSpacing = `${o.letterSpacing * pxPerMm}px`;
        ctx.wordSpacing = `${o.wordSpacing * pxPerMm}px`;

        const pitch = o.capHeight * pxPerMm * o.lineHeight,
            aMetric = aLine.map(s => ctx.measureText(s || " ")),
            // The advance width is what alignment is about; the ink box is what
            // the canvas has to be big enough for. Not the same number.
            wMax = Math.max(...aMetric.map(m => m.width)),
            aOrigin = aMetric.map((m, i) => ({
                x: o.align === "left" ? 0 : o.align === "center" ? (wMax - m.width) / 2 : wMax - m.width,
                y: i * pitch
            }));

        // Where every character starts. Taken from the advance of the text
        // *before* it rather than by summing per-glyph widths, so the kerning
        // and the tracking the shaper applied are already in the number.
        const aPen: { ch: string; x: number; y: number }[] = [];
        aLine.forEach((line, i) => {
            const or = aOrigin[i]!;
            for (const [j, ch] of [...line].entries()) {
                if (!ch.trim()) continue;
                aPen.push({ ch, x: or.x + ctx.measureText([...line].slice(0, j).join("")).width, y: or.y });
            }
        });

        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        aMetric.forEach((m, i) => {
            const or = aOrigin[i]!;
            x0 = Math.min(x0, or.x - m.actualBoundingBoxLeft);
            x1 = Math.max(x1, or.x + m.actualBoundingBoxRight);
            y0 = Math.min(y0, or.y - m.actualBoundingBoxAscent);
            y1 = Math.max(y1, or.y + m.actualBoundingBoxDescent);
        });
        return { fontPx, aOrigin, aPen, box: { x0, y0, x1, y1 } };
    };

    // Start from the resolution the glyphs want, then back off if that much text
    // would not fit on a canvas. Backing off is a real loss of fidelity, so it
    // only happens for a wall of text — and it scales, rather than clipping.
    let pxPerMm = RENDER_CAP_PX / Math.max(0.5, o.capHeight),
        laid = layOut(pxPerMm);
    const over = Math.max(
        (laid.box.x1 - laid.box.x0 + PAD_PX * 2) / MAX_PX,
        (laid.box.y1 - laid.box.y0 + PAD_PX * 2) / MAX_PX
    );
    if (over > 1) {
        pxPerMm /= over;
        laid = layOut(pxPerMm);
    }

    const { box } = laid;
    if (!isFinite(box.x0) || box.x1 <= box.x0 || box.y1 <= box.y0) {
        throw new Error("This text produced no glyphs to trace.");
    }

    const width = Math.ceil(box.x1 - box.x0) + PAD_PX * 2,
        height = Math.ceil(box.y1 - box.y0) + PAD_PX * 2;
    canvas.width = width;
    canvas.height = height;
    // Resizing a canvas resets its context, so the whole layout goes back on.
    layOut(pxPerMm);
    ctx.fillStyle = "#000";
    aLine.forEach((s, i) => {
        const or = laid.aOrigin[i]!;
        ctx.fillText(s, or.x - box.x0 + PAD_PX, or.y - box.y0 + PAD_PX);
    });

    return {
        img: {
            width,
            height,
            rgba: ctx.getImageData(0, 0, width, height).data,
            sourceWidth: width,
            sourceHeight: height,
            href: "",
            mode: "outline"
        },
        widthMm: width / pxPerMm,
        pxPerMm,
        fontPx: laid.fontPx,
        // Moved into the canvas' own coordinates, so a separately traced glyph
        // lands exactly where the whole-text render put it.
        aPen: laid.aPen.map(q => ({ ch: q.ch, x: q.x - box.x0 + PAD_PX, y: q.y - box.y0 + PAD_PX }))
    };
};

/**
 * Every character traced on its own, in the same millimetre space as the whole.
 *
 * The one-pass render fuses overlapping letters into a single silhouette — which
 * is the right geometry to cut, and the wrong thing to read. Setting each glyph
 * again by itself recovers the boundary the union threw away.
 */
interface TracedGlyph {
    rings: Point[][];
    box: Box;
}

/** Even-odd against one glyph's own rings: its counters are holes, not ink. */
const inGlyph = (p: Point, g: TracedGlyph): boolean =>
    p.x >= g.box.x0 && p.x <= g.box.x1 && p.y >= g.box.y0 && p.y <= g.box.y1
    && g.rings.reduce((n, a) => n + (inRing(p, a) ? 1 : 0), 0) % 2 === 1;

/**
 * The seams where the letters lap over each other.
 *
 * Letters are laid down in reading order, so a later one sits on top. Two rules
 * follow, and together they leave exactly the lines a sheet-of-paper stack
 * would show:
 *
 *   · engrave a letter's contour only where an *earlier* letter is underneath —
 *     everywhere else the silhouette's own edge already shows the shape, so a
 *     line there would be redundant and would sit on top of the cut;
 *   · and not where a *later* letter covers it, because that part is hidden.
 *
 * The first letter therefore gets nothing: there is nothing behind it to lap
 * onto.
 *
 * Two details keep the line continuous rather than dashed:
 *
 *   · *Segments* are classified by their midpoint, not vertices. A vertex that
 *     happens to sit on the other glyph's edge is a coin toss; a midpoint is
 *     only ever ambiguous if the whole segment is.
 *   · Short gaps are closed. Each glyph is traced from its own raster, so where
 *     two outlines run along each other they agree only to the tracer's own
 *     tolerance — and the classifier must not pretend to be more precise than
 *     its input, or the seam comes out as a dotted line.
 */
const clipToSeams = (aGlyph: TracedGlyph[], gapTol: number): Point[][] => {
    const overlaps = (a: Box, b: Box): boolean =>
        a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
    const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const len = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

    const out: Point[][] = [];
    aGlyph.forEach((g, i) => {
        const aUnder = aGlyph.slice(0, i).filter(h => overlaps(h.box, g.box)),
            aOver = aGlyph.slice(i + 1).filter(h => overlaps(h.box, g.box));
        if (!aUnder.length) return; // nothing behind it to lap onto

        for (const ring of g.rings) {
            const n = ring.length;
            if (n < 3) continue;

            const on = new Array<boolean>(n);
            for (let k = 0; k < n; k++) {
                const m = mid(ring[k]!, ring[(k + 1) % n]!);
                on[k] = aUnder.some(h => inGlyph(m, h)) && !aOver.some(h => inGlyph(m, h));
            }
            if (!on.some(Boolean)) continue;

            // Bridge the flicker: an off-run shorter than the tolerance, with
            // seam on both sides of it, was never a real gap.
            for (let k = 0; k < n; k++) {
                if (on[k]) continue;
                let j = k, run = 0;
                while (run <= gapTol && !on[j % n]) {
                    run += len(ring[j % n]!, ring[(j + 1) % n]!);
                    j++;
                    if (j - k >= n) break;
                }
                if (run <= gapTol && j - k < n) {
                    for (let q = k; q < j; q++) on[q % n] = true;
                }
                k = j - 1;
            }

            // Walk the ring once past its start, so a seam crossing the seam of
            // the ring itself comes out as one line rather than two.
            let start = on.indexOf(false);
            if (start < 0) { out.push([...ring, ring[0]!]); continue; }
            let run: Point[] = [];
            for (let q = 1; q <= n; q++) {
                const k = (start + q) % n;
                if (on[k]) {
                    if (!run.length) run.push(ring[k]!);
                    run.push(ring[(k + 1) % n]!);
                } else if (run.length > 1) {
                    out.push(run);
                    run = [];
                } else {
                    run = [];
                }
            }
            if (run.length > 1) out.push(run);
        }
    });
    return out;
};

const traceGlyphEdges = (o: TextOptions, r: Rendered): { rings: Point[][]; warnings: string[] } => {
    const warnings: string[] = [],
        rings: Point[][] = [];
    const aPen = r.aPen.slice(0, MAX_EDGE_GLYPHS);
    if (r.aPen.length > MAX_EDGE_GLYPHS) {
        warnings.push(`Only the first ${MAX_EDGE_GLYPHS} letters got their own engraved edge — past that, tracing each one apart takes longer than it is worth.`);
    }

    const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { rings, warnings };

    const aGlyph: TracedGlyph[] = [];
    for (const pen of aPen) {
        ctx.font = fontShorthand(o, r.fontPx);
        const m = ctx.measureText(pen.ch),
            left = m.actualBoundingBoxLeft,
            asc = m.actualBoundingBoxAscent,
            w = Math.ceil(left + m.actualBoundingBoxRight) + PAD_PX * 2,
            h = Math.ceil(asc + m.actualBoundingBoxDescent) + PAD_PX * 2;
        if (!(w > PAD_PX * 2) || !(h > PAD_PX * 2)) continue;

        canvas.width = w;
        canvas.height = h;
        // Resizing resets the context, so the face goes back on before drawing.
        ctx.font = fontShorthand(o, r.fontPx);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#000";
        ctx.fillText(pen.ch, left + PAD_PX, asc + PAD_PX);

        const img: TraceImage = {
            width: w,
            height: h,
            rgba: ctx.getImageData(0, 0, w, h).data,
            sourceWidth: w,
            sourceHeight: h,
            href: "",
            mode: "outline"
        };
        let traced;
        try {
            traced = buildTrace(img, prepareTrace(img, { mode: "outline", threshold: 128, invert: false, alpha: true }), {
                minArea: MIN_AREA_PX,
                smooth: o.smooth,
                optimize: o.simplify,
                prune: 0,
                style: "fill",
                widthMm: w / r.pxPerMm
            });
        } catch {
            continue; /* a glyph the tracer could make nothing of */
        }

        // Glyph space → the whole render's space, both in millimetres.
        const dx = (pen.x - (left + PAD_PX)) / r.pxPerMm,
            dy = (pen.y - (asc + PAD_PX)) / r.pxPerMm,
            placed = traced.aSub.map(sub => sub.points.map(q => ({ x: q.x + dx, y: q.y + dy })));
        if (placed.length) aGlyph.push({ rings: placed, box: ringBounds(placed) });
    }

    // The two outlines only agree to the trace tolerance where they run
    // along each other, so the gap bridged is scaled to the letter.
    rings.push(...clipToSeams(aGlyph, o.capHeight * 0.06));
    return { rings, warnings };
};

// ---------------------------------------------------------------------------
// The keyring hole
// ---------------------------------------------------------------------------

/** Where the hole's centre goes, given the plate it has to sit in. */
export const ringCentre = (box: Box, o: TextOptions): Point => {
    const w = box.x1 - box.x0,
        h = box.y1 - box.y0,
        t = Math.min(100, Math.max(0, o.ringOffset)) / 100;
    switch (o.ringEdge) {
        case "left": return { x: box.x0 + o.ringInset, y: box.y0 + h * t };
        case "right": return { x: box.x1 - o.ringInset, y: box.y0 + h * t };
        case "top": return { x: box.x0 + w * t, y: box.y0 + o.ringInset };
        default: return { x: box.x0 + w * t, y: box.y1 - o.ringInset };
    }
};

/** Even-odd: is the point inside the plate rather than in a hole in it? */
const insidePlate = (p: Point, aRing: Point[][]): boolean =>
    aRing.reduce((n, a) => n + (inRing(p, a) ? 1 : 0), 0) % 2 === 1;

/**
 * A ring split into the runs that lie outside the given shapes.
 *
 * Used where two cut lines have to give way to each other: the keyring tab must
 * not be cut through the letter it hangs off, and the letter must not be cut
 * through the tab, or the two would separate and both drop out of the sheet.
 *
 * Each run ends at the *crossing*, found by bisection, rather than at the last
 * vertex on the right side of it. That matters more than it sounds: a vertex is
 * up to a tenth of a millimetre from the true crossing, and stopping short
 * leaves an uncut sliver holding the part in the sheet, while running past
 * lasers a notch into material that should have stayed. Both curves bisect
 * against the same pair of outlines, so they meet at the same point and the
 * union comes out continuous.
 */
const openRunsOutside = (ring: Point[], aShape: Point[][]): Point[][] => {
    const inside = (p: Point): boolean => insidePlate(p, aShape);

    /** Where the segment crosses, to a thousandth of its own length. */
    const crossing = (a: Point, b: Point): Point => {
        let lo = a, hi = b; // lo outside, hi inside
        for (let i = 0; i < 12; i++) {
            const m = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
            if (inside(m)) hi = m; else lo = m;
        }
        return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
    };

    const n = ring.length,
        out: Point[][] = [];
    let run: Point[] = [];
    for (let k = 0; k <= n; k++) {
        const p = ring[k % n]!,
            q = ring[(k + 1) % n]!,
            bIn = inside(p),
            bNext = inside(q);

        if (!bIn) run.push(p);
        if (bIn !== bNext) {
            // Entering or leaving: carry the run right up to the boundary.
            const c = bIn ? crossing(q, p) : crossing(p, q);
            if (bIn) {
                run = [c];
            } else {
                run.push(c);
                if (run.length > 1) out.push(run);
                run = [];
            }
        }
    }
    if (run.length > 1) out.push(run);
    return out;
};

/** Does the hole, and a little material round it, land on the plate? */
const holeIsSafe = (c: Point, rOuter: number, aRing: Point[][]): boolean => {
    if (!aRing.length) return false;
    for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12;
        if (!insidePlate({ x: c.x + rOuter * Math.cos(a), y: c.y + rOuter * Math.sin(a) }, aRing)) return false;
    }
    return true;
};

// ---------------------------------------------------------------------------

const shift = (a: Point[], dx: number, dy: number): Point[] => a.map(p => ({ x: p.x - dx, y: p.y - dy }));

// ---------------------------------------------------------------------------
// Caching the traced type
//
// Setting the text and tracing it is by far the most expensive thing here, and
// it depends on *none* of the plate, keyring or laser settings. Without a cache,
// dragging the border slider re-rasterises and re-traces the whole word sixteen
// times a second to produce identical glyphs.
//
// One entry is enough: the settings change one at a time, so a second entry
// would only ever hold the state before the drag started.
// ---------------------------------------------------------------------------

interface GlyphCache {
    key: string;
    aGlyph: Point[][];
    glyphBox: Box;
    accuracy: number;
    warnings: string[];
    /** filled in the first time the letter edges are actually asked for */
    aEdge: Point[][] | null;
    edgeWarnings: string[];
}

let cache: GlyphCache | null = null;

/** Everything the glyphs depend on, and nothing else. */
const glyphKey = (o: TextOptions): string => [
    o.text, o.fontFamily, o.bold, o.italic, o.capHeight,
    o.letterSpacing, o.wordSpacing, o.lineHeight, o.align, o.smooth, o.simplify
].join(" ");

/** Set the text and trace it — or hand back the last time we did. */
const tracedGlyphs = (o: TextOptions, bEdges: boolean): GlyphCache => {
    const key = glyphKey(o);
    if (cache?.key === key && (!bEdges || cache.aEdge)) return cache;

    const rendered = renderText(o);
    if (!rendered) throw new Error("Type something for the laser to cut.");

    // A cache hit that only lacks the edges keeps the glyphs it already has.
    let entry = cache?.key === key ? cache : null;
    if (!entry) {
        const prep = prepareTrace(rendered.img, { mode: "outline", threshold: 128, invert: false, alpha: true }),
            traced = buildTrace(rendered.img, prep, {
                minArea: MIN_AREA_PX,
                smooth: o.smooth,
                optimize: o.simplify,
                prune: 0,
                style: "fill",
                widthMm: rendered.widthMm
            }),
            aGlyph = traced.aSub.map(sub => sub.points);
        if (!aGlyph.length) throw new Error("This text produced no glyphs to trace.");
        entry = {
            key,
            aGlyph,
            glyphBox: ringBounds(aGlyph),
            accuracy: traced.accuracy,
            // The tracer warns about its own "show points" overlay when a path
            // has more nodes than it will draw. There is no such overlay here,
            // and type at a faithful setting always trips it — so it would be a
            // permanent notice about a control this tool does not have.
            warnings: traced.warnings.filter(w => !w.includes("nodes —")),
            aEdge: null,
            edgeWarnings: []
        };
    }

    if (bEdges && !entry.aEdge) {
        const edges = traceGlyphEdges(o, rendered);
        entry.aEdge = edges.rings;
        entry.edgeWarnings = edges.warnings;
    }

    cache = entry;
    return entry;
};

export const buildTextDesign = (o: TextOptions): TextResult => {
    const warnings: string[] = [];

    const glyphs = tracedGlyphs(o, o.letterEdges),
        aGlyph = glyphs.aGlyph;
    warnings.push(...glyphs.warnings);

    // --- the plate, and the lug the hole may need -------------------------
    const glyphBox = glyphs.glyphBox;
    let aPlate: Point[][] = [],
        accuracy = glyphs.accuracy,
        autoReach = 0;

    // The hole is placed against the plate the border alone would make. Working
    // it out first is what lets the lug be *part of* the design the outline is
    // traced around, so the plate grows to include it instead of the hole being
    // punched through thin air.
    const estimate: Box = {
        x0: glyphBox.x0 - o.border, y0: glyphBox.y0 - o.border,
        x1: glyphBox.x1 + o.border, y1: glyphBox.y1 + o.border
    };
    const rHole = Math.max(0.3, o.ringDiameter / 2),
        centre = ringCentre(o.plate ? estimate : glyphBox, o);

    if (o.plate) {
        const aSub: Subpath[] = aGlyph.map(a => ({ points: simplifyRing(a, PLATE_SIMPLIFY), closed: true }));
        if (o.ring && o.ringWall > 0) {
            aSub.push({ points: circleRing(centre.x, centre.y, rHole + o.ringWall), closed: true });
        }
        const b = subBounds(aSub),
            doc: DesignDoc = {
                title: "Text",
                aSub,
                width: b.x1 - b.x0,
                height: b.y1 - b.y0,
                assumed: false,
                warnings: []
            };
        const out = buildOutline(doc, {
            border: o.border,
            scale: 1,
            selection: null,
            connect: o.connect ? { mode: o.connectMode, reach: o.reach || undefined } : null
        });
        aPlate = out.aRing;
        accuracy = Math.max(accuracy, out.accuracy);
        autoReach = out.autoReach;
        warnings.push(...out.warnings);
    }

    // --- the hole ---------------------------------------------------------
    const aHole: Point[][] = [],
        /** cut lines that stop where they meet material, rather than closing */
        aOpenCut: Point[][] = [];
    /** the standalone keyring tab, when there is no plate to punch through */
    let tabDisc: Point[] | null = null;
    if (o.ring) {
        aHole.push(circleRing(centre.x, centre.y, rHole));
        if (o.plate) {
            if (!holeIsSafe(centre, rHole + Math.max(0.8, o.ringWall * 0.6), aPlate)) {
                warnings.push(
                    "The keyring hole is not fully on the plate — move it along the edge, push it further in, "
                    + "or give it a wall so the plate grows around it."
                );
            }
        } else if (o.ringWall > 0) {
            // No plate to punch through, so the ring brings its own body: a tab
            // of the wall's thickness around the hole.
            //
            // Cut only where it is *not* already inside a letter, or the circle
            // would be cut straight through the letter it is meant to hang off
            // and both would fall out. What is left is the arc that closes the
            // tab against the lettering.
            tabDisc = circleRing(centre.x, centre.y, rHole + o.ringWall);
            const outside = openRunsOutside(tabDisc, aGlyph);
            if (outside.length === 1 && outside[0]!.length >= tabDisc.length) {
                warnings.push("The keyring tab does not touch a letter, so it would come off the bed as a loose ring — move it onto the lettering, or turn the backing plate on.");
            }
            aOpenCut.push(...outside);
        } else {
            warnings.push("The hole has nothing to go through — give the ring a wall so it brings its own tab, or turn the backing plate on.");
        }
    }

    // --- what the laser does with each part -------------------------------
    const aLayer: TextLayer[] = [];
    if (o.letters === "engrave") {
        aLayer.push({ operation: ENGRAVE, rings: aGlyph, filled: true });
    } else if (o.letters === "cut") {
        if (tabDisc) {
            // The tab holds the lettering up, so the letters must not be cut
            // through where it sits behind them — the same courtesy the tab
            // already pays them. Both are cut only outside the other.
            const open = aGlyph.flatMap(a => openRunsOutside(a, [tabDisc!]));
            if (open.length) aLayer.push({ operation: CUT, rings: open, filled: false, open: true });
        } else {
            aLayer.push({ operation: CUT, rings: aGlyph, filled: false });
        }
    }

    // Each letter's own edge, over the top. Where one laps over the previous
    // the union has no boundary left to show, so this puts it back as a line.
    let aEdge: Point[][] = [];
    if (o.letterEdges) {
        aEdge = glyphs.aEdge ?? [];
        warnings.push(...glyphs.edgeWarnings);
        if (aEdge.length) aLayer.push({ operation: LINE, rings: aEdge, filled: false, open: true });
    }

    const aCut = [...aPlate, ...aHole];
    if (aCut.length) aLayer.push({ operation: CUT, rings: aCut, filled: false });
    if (aOpenCut.length) aLayer.push({ operation: CUT, rings: aOpenCut, filled: false, open: true });

    if (!aLayer.length) {
        warnings.push("Nothing would be cut or engraved — turn the backing plate on, or give the letters an operation.");
    }

    // --- normalise to the piece's own origin ------------------------------
    const all = aLayer.flatMap(l => l.rings);
    const box = all.length ? ringBounds(all) : glyphBox,
        width = box.x1 - box.x0,
        height = box.y1 - box.y0;
    for (const layer of aLayer) layer.rings = layer.rings.map(a => shift(a, box.x0, box.y0));

    // --- preview ----------------------------------------------------------
    //
    // Drawn from the very layers that get exported, not from the geometry they
    // were made of. Drawing the raw glyphs here was a quiet lie: where the
    // keyring tab clips a letter, the export stops the cut at the crossing
    // while the preview carried on to the hole — so the picture showed a cut
    // that was not in the file, and a gap where the file has none.
    const sw = Math.max(0.05, width / 500),
        svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(width)} ${r3(height)}">`,
        plateShift = aPlate.map(a => shift(a, box.x0, box.y0)),
        holeShift = aHole.map(a => shift(a, box.x0, box.y0));

    /** What the material looks like under the lines: plate, then the hole. */
    const ground = (plateShift.length
        ? `<path d="${plateShift.map(a => pathData(a)).join(" ")}" fill="#22d3ee" fill-opacity="0.5" fill-rule="evenodd"/>`
        : "")
        + (o.letters === "none" && !plateShift.length
            // Nothing would be drawn at all otherwise: no fill, no letter lines.
            ? `<path d="${aGlyph.map(a => pathData(shift(a, box.x0, box.y0))).join(" ")}" fill="#334155" fill-opacity="0.35" fill-rule="evenodd"/>`
            : "")
        + (holeShift.length
            ? `<path d="${holeShift.map(a => pathData(a)).join(" ")}" fill="#ffffff" fill-rule="evenodd"/>`
            : "");

    const preview = svgOpen + ground + aLayer.map(l => {
        const d = l.rings.map(a => pathData(a, !l.open)).join(" ");
        if (l.filled) {
            return `<path d="${d}" fill="${l.operation.css}" fill-opacity="0.9" fill-rule="evenodd"/>`;
        }
        // A line engraving is thinner than a cut: they overlap in places, and
        // the cut is the one that has to be legible.
        const w = l.operation === LINE ? sw * 1.2 : sw * 1.6;
        return `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="${r3(w)}"`
            + ` stroke-linecap="round"/>`;
    }).join("") + "</svg>";

    return {
        preview,
        aLayer,
        width,
        height,
        shapes: aGlyph.length,
        edges: aEdge.length,
        points: aLayer.reduce((n, l) => n + l.rings.reduce((m, a) => m + a.length, 0), 0),
        pieces: aPlate.length + aHole.length + aOpenCut.length + (o.letters === "cut" ? aGlyph.length : 0),
        accuracy,
        autoReach,
        ring: o.ring ? { x: centre.x - box.x0, y: centre.y - box.y0 } : null,
        // What the hole is positioned against, in the same coordinates — so a
        // drag on the canvas can be turned back into an edge and an offset.
        ringBox: o.plate
            ? { x0: estimate.x0 - box.x0, y0: estimate.y0 - box.y0, x1: estimate.x1 - box.x0, y1: estimate.y1 - box.y0 }
            : { x0: glyphBox.x0 - box.x0, y0: glyphBox.y0 - box.y0, x1: glyphBox.x1 - box.x0, y1: glyphBox.y1 - box.y0 },
        warnings
    };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const textToSvg = (r: TextResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + r.aLayer.map(l => {
        const d = l.rings.map(a => pathData(a, !l.open)).join(" ");
        return l.filled
            ? `<path d="${d}" fill="${l.operation.css}" fill-rule="evenodd"/>`
            : `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="${EXPORT_STROKE}"/>`;
    }).join("")
    + "</svg>";

/**
 * DXF has no fills, so an engraved letter goes out as its closed contours in
 * the engraving colour and the alternation is left to the laser software —
 * which is how it fills nested closed contours anyway.
 */
export const textToDxf = (r: TextResult): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.rings.map(a => ({
            color: l.operation.color,
            closed: !l.open,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const textToFds = (r: TextResult): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: l.filled ? 0 : l.open ? 1 : 2,
        subpaths: l.rings.map(a => ({ points: a, closed: !l.open }))
    })));
