import { getCanvasGeometry, getLocalGeometry } from "./convert";
import type { XcsProject } from "./convert";
import { OPERATION_COLORS } from "./dxf";
import type { Point, Subpath } from "./dxf";
import { isXsArchive, parseXs } from "./xs";

// ---------------------------------------------------------------------------
// Outline tracing: a design → the closed cut line around its items.
//
// The use case is a backing plate: cut the contour out of sheet material and
// glue the original on top. Only the OUTER boundary matters — holes and inner
// detail belong to a piece that is going to be covered up anyway.
//
// The contour is taken from the geometry itself, not from a picture of it: an
// item's outermost subpath *is* the cut line, so with no border the export is
// exact to the 0.01 mm the curve flattener works at. A border is the one thing
// that cannot be had exactly — offsetting a polygon outwards means resolving the
// self-intersections it creates — so that step runs over a fine bitmap and
// reports the resolution it used. It also welds items whose borders meet, which
// is how several items end up under one plate.
// ---------------------------------------------------------------------------

/** Cutting red, the same colour the DXF/SVG conversion uses for cut lines. */
export const CUT_COLOR = OPERATION_COLORS.VECTOR_CUTTING!.css;

/** Preview colours: a traced item, one left out, the border, the cut line. */
export const ITEM_COLOR = "#334155";
export const MUTED_COLOR = "#94a3b8";
export const BORDER_COLOR = "#22d3ee";

/** Resolution the border offset is computed at, and the bitmap budget for it. */
const OFFSET_PX_PER_MM = 40;
const OFFSET_MAX_PX = 1800;

/** Connecting items with necks: width of a neck, and the fillet blending it in (mm). */
const BRIDGE_MM = 4;
const FILLET_MM = 3;

/** How the items of a selection are joined into one plate. */
export type ConnectMode = "wrap" | "bridge" | "hull";

export interface ConnectOptions {
    mode: ConnectMode;
    /** shrink-wrap reach in mm; 0 or undefined = derived from the gaps */
    reach?: number;
}

/** Line width of the exported cut path, in mm. */
const EXPORT_STROKE = 0.3;

/** Subpaths enclosing less than this are noise, not items or holes (mm²). */
const MIN_RING_AREA = 0.01;

/** CSS px per millimetre — the 96 dpi every SVG importer falls back to. */
const PX_PER_MM = 96 / 25.4;

const SVG_NS = "http://www.w3.org/2000/svg";

export interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface OutlineDoc {
    title: string;
    /** the design's geometry in millimetres, curves flattened to polylines */
    aSub: Subpath[];
    /** bounding box size of that geometry, mm */
    width: number;
    height: number;
    /** the source SVG stated no physical size, so 96 dpi was assumed on its units */
    assumed: boolean;
    warnings: string[];
}

/** One thing standing on its own in the design — a candidate for tracing. */
export interface OutlineItem {
    /** the item's own outer contour, in mm */
    pts: Point[];
    area: number;
    box: Box;
    /** the contour came from an open path and had to be closed */
    open: boolean;
    /** indices into the design's subpaths that belong to this item */
    aSubIdx: number[];
}

export interface OutlineOptions {
    /** millimetres added around each item — 0 traces its own contour exactly */
    border: number;
    /** multiplier on the geometry, for an SVG whose physical size had to be guessed */
    scale: number;
    /** which items to trace, by index into the returned list; null = all of them */
    selection: number[] | null;
    /** join the traced items into one plate; null leaves them as separate cut lines */
    connect: ConnectOptions | null;
}

export interface OutlineResult {
    /** cut-ready SVG in millimetres (1 user unit = 1 mm); empty when nothing is selected */
    svg: string;
    /** the same, with the traced items' own geometry alongside the cut line */
    svgWithDesign: string;
    /** on-screen preview: the items, the border they gain and the cut line */
    preview: string;
    /** size of the cut lines in mm */
    width: number;
    height: number;
    /** separate closed cut lines in the export */
    pieces: number;
    points: number;
    /** 0 when the contours are exact, otherwise the bitmap step of the offset (mm) */
    accuracy: number;
    /** shrink-wrap reach the gaps in the selection ask for, mm */
    autoReach: number;
    /** every item in the design, in the order the selection indices refer to */
    aItem: OutlineItem[];
    /** the indices actually traced */
    aSelected: number[];
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Reading the input
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
    "": 1, px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: PX_PER_MM, q: PX_PER_MM / 4
};

/** An SVG length in CSS px, or null for percentages and other relative values. */
const parseLength = (s: string | null): number | null => {
    const m = /^\s*([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(s || "");
    if (!m) return null;
    const f = UNITS[m[2]!.toLowerCase()];
    return f === undefined ? null : parseFloat(m[1]!) * f;
};

interface SvgDoc {
    root: SVGSVGElement;
    /** millimetres per SVG user unit */
    mmPerUnit: number;
    /** the authored viewBox in user units */
    view: { x: number; y: number; w: number; h: number };
    assumed: boolean;
}

/**
 * Work out how big an SVG really is. Two things decide it: a viewBox (the unit
 * system the geometry is written in) and the root width/height (that system's
 * physical size). With both, the millimetre scale is exact; with only a viewBox,
 * 96 dpi is assumed — the same guess every importer makes — and the caller is
 * told, so it can offer an override.
 */
const parseSvgDoc = (sMarkup: string): SvgDoc => {
    const oParsed = new DOMParser().parseFromString(sMarkup, "image/svg+xml");
    if (oParsed.querySelector("parsererror") || oParsed.documentElement.tagName.toLowerCase() !== "svg") {
        throw new Error("This file is not a readable SVG.");
    }
    const root = oParsed.documentElement as unknown as SVGSVGElement,
        aVB = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number),
        wPx = parseLength(root.getAttribute("width")),
        hPx = parseLength(root.getAttribute("height"));

    if (aVB.length === 4 && aVB.every(n => isFinite(n)) && aVB[2]! > 0 && aVB[3]! > 0) {
        const view = { x: aVB[0]!, y: aVB[1]!, w: aVB[2]!, h: aVB[3]! };
        // Prefer the width: with a non-uniform ratio the height would disagree,
        // and an importer scales off the width too.
        if (wPx !== null && wPx > 0) return { root, view, mmPerUnit: wPx / PX_PER_MM / view.w, assumed: false };
        if (hPx !== null && hPx > 0) return { root, view, mmPerUnit: hPx / PX_PER_MM / view.h, assumed: false };
        return { root, view, mmPerUnit: 1 / PX_PER_MM, assumed: true };
    }

    // No viewBox: user units are CSS px, whatever the viewport is sized in.
    if (wPx !== null && hPx !== null && wPx > 0 && hPx > 0) {
        return { root, view: { x: 0, y: 0, w: wPx, h: hPx }, mmPerUnit: 1 / PX_PER_MM, assumed: false };
    }
    throw new Error("This SVG states neither a viewBox nor a size, so there is nothing to scale it by.");
};

/**
 * Pull the geometry out of an SVG file in millimetres. The document is mounted
 * off-screen at 1 px per millimetre and read back through the browser's own
 * getCTM(), the same trick the DXF export uses — that way nested transforms,
 * groups and units are the browser's problem, not ours.
 */
const extractSvgGeometry = (doc: SvgDoc): { aSub: Subpath[]; warnings: string[] } => {
    const W = doc.view.w * doc.mmPerUnit,
        H = doc.view.h * doc.mmPerUnit,
        aWarnings: string[] = [];
    if (!(W > 0) || !(H > 0)) throw new Error("This SVG has no usable size.");

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.style.cssText = "position:absolute;left:-100000px;top:0;opacity:0;pointer-events:none";

    // The file's children are re-parented under a scale of mm per user unit; the
    // root's own width/height/viewBox stay behind, or the geometry would be
    // transformed twice.
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", `scale(${doc.mmPerUnit}) translate(${-doc.view.x}, ${-doc.view.y})`);
    for (const node of [...doc.root.childNodes]) {
        const sTag = node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : "";
        // A <style> from the file would apply to the whole page once mounted, and
        // a <script> has no business here either. Neither carries geometry.
        if (sTag === "style" || sTag === "script") continue;
        g.appendChild(document.importNode(node, true));
    }
    svg.appendChild(g);
    document.body.appendChild(svg);

    const aSub: Subpath[] = [];
    try {
        if (svg.querySelector("text")) {
            aWarnings.push("Text in this SVG was ignored — convert it to paths before tracing, or the outline will miss it.");
        }
        svg.querySelectorAll<SVGGraphicsElement>("path,rect,circle,ellipse,line,polygon,polyline,image").forEach(el => {
            const m = el.getCTM();
            if (!m) return;
            getLocalGeometry(el).forEach(sub => {
                if (sub.points.length < 2) return;
                aSub.push({
                    closed: sub.closed,
                    points: sub.points.map(p => ({
                        x: m.a * p.x + m.c * p.y + m.e,
                        y: m.b * p.x + m.d * p.y + m.f
                    }))
                });
            });
        });
    } finally {
        document.body.removeChild(svg);
    }

    return { aSub, warnings: aWarnings };
};

const subBounds = (aSub: Subpath[]): Box => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of aSub) {
        for (const p of s.points) {
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.y > y1) y1 = p.y;
        }
    }
    return { x0, y0, x1, y1 };
};

const ringBounds = (aRing: Point[][]): Box =>
    subBounds(aRing.map(a => ({ points: a, closed: true })));

const makeDoc = (title: string, aSub: Subpath[], assumed: boolean, warnings: string[]): OutlineDoc => {
    const b = subBounds(aSub);
    return { title, aSub, width: b.x1 - b.x0, height: b.y1 - b.y0, assumed, warnings };
};

/**
 * Read a dropped file into one traceable design per canvas. .xcs/.xs projects go
 * through the same geometry extraction as the DXF export, so the outline is
 * traced around exactly what would be cut.
 */
export const readOutlineFile = async (file: File): Promise<{ name: string; aDoc: OutlineDoc[] }> => {
    const buf = await file.arrayBuffer(),
        name = file.name.replace(/\.[^.]+$/, ""),
        // Detected by content, not by extension: .xcs is plain JSON, .xs a ZIP.
        bZip = isXsArchive(buf),
        sText = bZip ? "" : new TextDecoder().decode(buf);

    if (bZip || sText.trimStart().startsWith("{")) {
        const oJSON: XcsProject = bZip ? parseXs(buf) : JSON.parse(sText) as XcsProject;
        if (!Array.isArray(oJSON.canvas)) throw new Error("not an xcs project");
        const aDoc = oJSON.canvas
            .map(c => ({ title: c.title.replace("{panel}", "Canvas "), aSub: getCanvasGeometry(oJSON, c) }))
            .filter(o => o.aSub.length > 0)
            .map(o => makeDoc(o.title, o.aSub, false, []));
        if (!aDoc.length) throw new Error("This project has no geometry to trace an outline around.");
        return { name, aDoc };
    }

    const doc = parseSvgDoc(sText),
        { aSub, warnings } = extractSvgGeometry(doc);
    if (!aSub.length) throw new Error("This SVG holds no geometry to trace an outline around.");
    return { name, aDoc: [makeDoc("Design", aSub, doc.assumed, warnings)] };
};

// ---------------------------------------------------------------------------
// Finding the items
// ---------------------------------------------------------------------------

/** Signed-area magnitude of a ring; also weeds out degenerate subpaths. */
const ringArea = (a: Point[]): number => {
    let s = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
        s += a[j]!.x * a[i]!.y - a[i]!.x * a[j]!.y;
    }
    return Math.abs(s) / 2;
};

/** Even-odd ray cast: is the point inside the ring? */
const inRing = (p: Point, a: Point[]): boolean => {
    let bIn = false;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
        const pi = a[i]!, pj = a[j]!;
        if ((pi.y > p.y) !== (pj.y > p.y)
            && p.x < pi.x + ((p.y - pi.y) / (pj.y - pi.y)) * (pj.x - pi.x)) {
            bIn = !bIn;
        }
    }
    return bIn;
};

const boxInside = (a: Box, b: Box): boolean =>
    a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

/**
 * Split the design into items and give each one its outer contour.
 *
 * Every subpath is taken as a ring (an open one counts as closed: a line of
 * engraving inside a shape is still enclosed by it), and a ring is an item when
 * no other ring contains it. Holes and inner detail therefore drop out by
 * themselves, and two things standing side by side come out as two items.
 */
const buildItems = (aSub: Subpath[]): OutlineItem[] => {
    interface Ring {
        pts: Point[];
        box: Box;
        area: number;
        open: boolean;
        iSub: number;
    }

    const aRing: Ring[] = aSub
        .map((s, iSub) => ({ pts: s.points, box: subBounds([s]), area: ringArea(s.points), open: !s.closed, iSub }))
        .filter(r => r.pts.length >= 3 && r.area >= MIN_RING_AREA)
        .sort((a, b) => b.area - a.area);

    if (!aRing.length) throw new Error("This design has no shape big enough to trace an outline around.");

    // Only a larger ring can contain a smaller one, so with the rings sorted by
    // area each is tested against the items found so far — and the cheap box test
    // keeps the point-in-ring maths off almost every pair.
    const aTop: Ring[] = [];
    for (const r of aRing) {
        if (!aTop.some(o => boxInside(r.box, o.box) && inRing(r.pts[0]!, o.pts))) aTop.push(r);
    }

    const aItem: OutlineItem[] = aTop.map(r => ({
        pts: r.pts, area: r.area, box: r.box, open: r.open, aSubIdx: []
    }));

    // Hand every subpath — including the specks and open bits skipped above — to
    // the item enclosing it, so the preview can draw the items apart.
    aSub.forEach((s, i) => {
        if (!s.points.length) return;
        const iOwn = aTop.findIndex(r => r.iSub === i);
        if (iOwn >= 0) {
            aItem[iOwn]!.aSubIdx.push(i);
            return;
        }
        let iBest = -1;
        const box = subBounds([s]);
        aItem.forEach((it, k) => {
            if (boxInside(box, it.box) && inRing(s.points[0]!, it.pts) && (iBest < 0 || it.area < aItem[iBest]!.area)) {
                iBest = k;
            }
        });
        if (iBest >= 0) aItem[iBest]!.aSubIdx.push(i);
    });

    return aItem;
};

/** The item under a point in design coordinates — the smallest one, or -1. */
export const hitItem = (aItem: OutlineItem[], p: Point): number => {
    let iBest = -1;
    aItem.forEach((it, i) => {
        if (p.x < it.box.x0 || p.x > it.box.x1 || p.y < it.box.y0 || p.y > it.box.y1) return;
        if (inRing(p, it.pts) && (iBest < 0 || it.area < aItem[iBest]!.area)) iBest = i;
    });
    return iBest;
};

// ---------------------------------------------------------------------------
// Border: grow or shrink by an exact radius
// ---------------------------------------------------------------------------

const INF = 1e20;

// Felzenszwalb & Huttenlocher's exact distance transform, one dimension at a
// time: the lower envelope of the parabolas rooted at each sample. Two passes
// (columns, then rows) give the exact squared Euclidean distance, which is what
// makes the border a true offset instead of the diamond a naive dilation gives.
const edt1d = (f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
        let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
        while (s <= z[k]!) {
            k--;
            s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1]! < q) k++;
        d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
    }
};

/** Squared distance of every pixel to the nearest pixel whose mask value is `target`. */
const distanceTo = (m: Uint8Array, w: number, h: number, target: number): Float64Array => {
    const out = new Float64Array(w * h),
        iMax = Math.max(w, h),
        f = new Float64Array(iMax),
        d = new Float64Array(iMax),
        v = new Int32Array(iMax),
        z = new Float64Array(iMax + 1);

    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = m[y * w + x] === target ? 0 : INF;
        edt1d(f, h, d, v, z);
        for (let y = 0; y < h; y++) out[y * w + x] = d[y]!;
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = out[y * w + x]!;
        edt1d(f, w, d, v, z);
        for (let x = 0; x < w; x++) out[y * w + x] = d[x]!;
    }
    return out;
};

/** Grow (r > 0) or shrink (r < 0) the mask by r pixels. */
const offsetMask = (m: Uint8Array, w: number, h: number, r: number): Uint8Array => {
    if (Math.abs(r) < 0.5) return m;
    const bGrow = r > 0,
        d2 = distanceTo(m, w, h, bGrow ? 1 : 0),
        rr = r * r,
        out = new Uint8Array(m.length);
    for (let i = 0; i < m.length; i++) {
        out[i] = (bGrow ? m[i] || d2[i]! <= rr : m[i] && d2[i]! > rr) ? 1 : 0;
    }
    return out;
};

interface Piece {
    label: number;
    /** first pixel in reading order — topmost, then leftmost, as the tracer needs */
    seed: number;
    area: number;
}

/** Label every 8-connected island of the mask. */
const findPieces = (m: Uint8Array, w: number, h: number): { labels: Int32Array; aPiece: Piece[] } => {
    const n = w * h,
        labels = new Int32Array(n),
        stack = new Int32Array(n),
        aPiece: Piece[] = [];

    for (let iSeed = 0; iSeed < n; iSeed++) {
        if (!m[iSeed] || labels[iSeed]) continue;
        const label = aPiece.length + 1;
        let sp = 0,
            area = 0;
        labels[iSeed] = label;
        stack[sp++] = iSeed;
        while (sp > 0) {
            const i = stack[--sp]!,
                x = i % w,
                y = (i / w) | 0;
            area++;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= w) continue;
                    const j = ny * w + nx;
                    if (m[j] && !labels[j]) {
                        labels[j] = label;
                        stack[sp++] = j;
                    }
                }
            }
        }
        aPiece.push({ label, seed: iSeed, area });
    }
    return { labels, aPiece };
};

// ---------------------------------------------------------------------------
// Contour tracing (marching squares)
// ---------------------------------------------------------------------------

/**
 * Walk the outer boundary of one island, returning it as a closed ring of pixel
 * corner coordinates. Holes are ignored: the walk only ever follows the outside.
 *
 * The walker sits on the corner lattice and reads the 2×2 pixels around the
 * current corner; that 4-bit state says where the boundary continues. Travel
 * always keeps the island on the right-hand side, and the two ambiguous diagonal
 * states (6 and 9) are resolved in favour of staying attached to the diagonal,
 * matching the 8-connectivity the islands were labelled with.
 */
const traceContour = (labels: Int32Array, w: number, h: number, oPiece: Piece): Point[] => {
    const at = (x: number, y: number): number =>
        x < 0 || y < 0 || x >= w || y >= h ? 0 : labels[y * w + x] === oPiece.label ? 1 : 0;

    // The top-left corner of the island's first pixel in reading order: its state
    // is always 8 (only the bottom-right pixel belongs to it), so the walk starts
    // heading right and passes through this corner exactly once.
    const sx = oPiece.seed % w,
        sy = (oPiece.seed / w) | 0,
        aPts: Point[] = [],
        // A boundary cannot be longer than the lattice it runs on; the cap only
        // guards against a walk that never gets back to its start.
        iLimit = 4 * w * h + 8;
    let cx = sx, cy = sy, dx = 1, dy = 0;

    do {
        aPts.push({ x: cx, y: cy });
        const state = at(cx - 1, cy - 1) | (at(cx, cy - 1) << 1) | (at(cx - 1, cy) << 2) | (at(cx, cy) << 3);
        switch (state) {
            case 1: case 3: case 11: dx = -1; dy = 0; break;
            case 2: case 10: case 14: dx = 0; dy = -1; break;
            case 4: case 5: case 7: dx = 0; dy = 1; break;
            case 8: case 12: case 13: dx = 1; dy = 0; break;
            case 6: dy = dx === 1 ? -1 : 1; dx = 0; break;
            case 9: dx = dy === -1 ? -1 : 1; dy = 0; break;
            default: return aPts; // 0 and 15 are not boundary states
        }
        cx += dx;
        cy += dy;
    } while ((cx !== sx || cy !== sy) && aPts.length < iLimit);

    return aPts;
};

/**
 * Sliding average over the ring, three points wide: enough to take the 1 px
 * staircase off a traced boundary, far too little to round a corner. Not a design
 * knob — the exported contour is meant to be the offset, not a prettier curve.
 */
const deStair = (aPts: Point[]): Point[] => {
    const n = aPts.length;
    if (n < 8) return aPts;
    return aPts.map((_, i) => {
        const a = aPts[(i + n - 1) % n]!, b = aPts[i]!, c = aPts[(i + 1) % n]!;
        return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    });
};

const distToSegment = (p: Point, a: Point, b: Point): number => {
    const vx = b.x - a.x,
        vy = b.y - a.y,
        len = vx * vx + vy * vy;
    let t = len ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a.x + t * vx - p.x,
        ey = a.y + t * vy - p.y;
    return Math.sqrt(ex * ex + ey * ey);
};

/** Douglas–Peucker on an open polyline. */
const simplifyOpen = (aPts: Point[], tol: number): Point[] => {
    const n = aPts.length;
    if (n < 3) return aPts.slice();
    const keep = new Uint8Array(n),
        aStack: [number, number][] = [[0, n - 1]];
    keep[0] = 1;
    keep[n - 1] = 1;
    while (aStack.length) {
        const [i, j] = aStack.pop()!;
        let iFar = -1,
            dFar = 0;
        for (let k = i + 1; k < j; k++) {
            const d = distToSegment(aPts[k]!, aPts[i]!, aPts[j]!);
            if (d > dFar) { dFar = d; iFar = k; }
        }
        if (iFar >= 0 && dFar > tol) {
            keep[iFar] = 1;
            aStack.push([i, iFar], [iFar, j]);
        }
    }
    return aPts.filter((_, i) => keep[i]);
};

/** Douglas–Peucker on a closed ring, cut at its two extremes so it cannot collapse. */
const simplifyRing = (aPts: Point[], tol: number): Point[] => {
    const n = aPts.length;
    if (n < 8) return aPts;
    const p0 = aPts[0]!;
    let iFar = 0,
        dFar = -1;
    aPts.forEach((p, i) => {
        const d = (p.x - p0.x) ** 2 + (p.y - p0.y) ** 2;
        if (d > dFar) { dFar = d; iFar = i; }
    });
    const a = simplifyOpen(aPts.slice(0, iFar + 1), tol),
        b = simplifyOpen([...aPts.slice(iFar), p0], tol);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
};

/**
 * A ring resampled to evenly spaced points, enough of them to find where two
 * rings come closest and few enough to compare them all against each other.
 * Resampling rather than thinning: a rectangle arrives as four corners, and the
 * closest point between two rectangles is hardly ever a corner.
 */
const resample = (a: Point[], n: number): Point[] => {
    if (a.length < 3) return a;
    const aSeg: number[] = [];
    let total = 0;
    for (let i = 0; i < a.length; i++) {
        const p = a[i]!,
            q = a[(i + 1) % a.length]!,
            d = Math.hypot(q.x - p.x, q.y - p.y);
        aSeg.push(d);
        total += d;
    }
    if (!total) return a;

    const step = total / n,
        out: Point[] = [];
    let acc = 0,
        next = 0;
    for (let i = 0; i < a.length && out.length < n; i++) {
        const p = a[i]!,
            q = a[(i + 1) % a.length]!,
            d = aSeg[i]!;
        while (next <= acc + d && out.length < n) {
            const t = d ? (next - acc) / d : 0;
            out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
            next += step;
        }
        acc += d;
    }
    return out.length >= 3 ? out : a;
};

const centroid = (a: Point[]): Point => ({
    x: a.reduce((s, p) => s + p.x, 0) / a.length,
    y: a.reduce((s, p) => s + p.y, 0) / a.length
});

/**
 * The gaps that have to be closed to make the rings one piece: a minimum spanning
 * tree over their closest point pairs, so every item is reached and no gap is
 * bridged twice. Used both to draw necks and to work out how far a shrink-wrap
 * has to reach.
 */
const bridges = (aRing: Point[][]): { a: Point; b: Point; d2: number }[] => {
    const n = aRing.length;
    if (n < 2) return [];

    // Every ring is compared against every other, so the sampling thins out as the
    // selection grows — a word's worth of letters would otherwise cost millions of
    // point pairs on every slider nudge.
    const aThin = aRing.map(a => resample(a, n > 12 ? 120 : 300)),
        aMid = aThin.map(centroid),
        pair: { a: Point; b: Point; d2: number }[][] = [];
    for (let i = 0; i < n; i++) {
        pair.push([]);
        for (let j = 0; j < n; j++) {
            if (j <= i) {
                pair[i]!.push(j < i ? pair[j]![i]! : { a: aThin[i]![0]!, b: aThin[i]![0]!, d2: 0 });
                continue;
            }
            // Two facing edges are all equally close, so among the pairs that tie
            // for shortest the one nearest the line between the two items wins —
            // a neck through the middle rather than off a corner.
            const target = { x: (aMid[i]!.x + aMid[j]!.x) / 2, y: (aMid[i]!.y + aMid[j]!.y) / 2 };
            let best = { a: aThin[i]![0]!, b: aThin[j]![0]!, d2: Infinity },
                dTie = Infinity;
            for (const p of aThin[i]!) {
                for (const q of aThin[j]!) {
                    const d2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2,
                        eps = 1e-6 * (1 + best.d2);
                    if (d2 > best.d2 + eps) continue;
                    const tie = ((p.x + q.x) / 2 - target.x) ** 2 + ((p.y + q.y) / 2 - target.y) ** 2;
                    if (d2 < best.d2 - eps || tie < dTie) {
                        best = { a: p, b: q, d2 };
                        dTie = tie;
                    }
                }
            }
            pair[i]!.push(best);
        }
    }

    // Prim's algorithm — with a handful of items the plain O(n²) sweep is fine.
    const aIn = [0],
        aOut: { a: Point; b: Point; d2: number }[] = [],
        setRest = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
    while (setRest.size) {
        let best: { j: number; edge: { a: Point; b: Point; d2: number } } | null = null,
            dBest = Infinity;
        for (const i of aIn) {
            for (const j of setRest) {
                const e = pair[Math.min(i, j)]![Math.max(i, j)]!;
                if (e.d2 < dBest) {
                    dBest = e.d2;
                    best = { j, edge: e };
                }
            }
        }
        if (!best) break;
        aIn.push(best.j);
        setRest.delete(best.j);
        aOut.push(best.edge);
    }
    return aOut;
};

/**
 * Where a shrink-wrap has to start from: half the widest gap it must span, since
 * it grows from both sides at once.
 *
 * Only a starting point, not the answer. Closing bridges a gap between two long
 * parallel edges at exactly that radius, but between two round or pointy shapes it
 * pinches back apart — the reach needed there grows with the gap and shrinks with
 * how big the shapes are. Rather than model that, buildOutline() raises the reach
 * until the pieces actually come out as one.
 */
export const autoReach = (aRing: Point[][]): number => {
    const aGap = bridges(aRing).map(e => Math.sqrt(e.d2));
    return aGap.length ? Math.max(0.5, (Math.max(...aGap) / 2) * 1.15) : 0;
};

/** Convex hull (Andrew's monotone chain) — a taut band around everything. */
const convexHull = (aPts: Point[]): Point[] => {
    const a = [...aPts].sort((p, q) => p.x - q.x || p.y - q.y);
    if (a.length < 3) return a;
    const cross = (o: Point, p: Point, q: Point): number =>
        (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    const half = (src: Point[]): Point[] => {
        const out: Point[] = [];
        for (const p of src) {
            while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
            out.push(p);
        }
        return out;
    };
    const lower = half(a),
        upper = half([...a].reverse());
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};

/**
 * Offset rings outwards (or inwards) by r millimetres, optionally joined up.
 *
 * Done on a bitmap: the rings are filled, the fill grown by the exact Euclidean
 * distance transform, and every island traced back out. That sidesteps the
 * self-intersections a vector offset runs into at concave corners, and it is what
 * merges items whose borders overlap into one cut line. The price is the step size
 * it reports back: 0.025 mm for anything up to 45 mm across, coarser only when the
 * bitmap budget runs out.
 *
 * Connecting happens in the same pass, either way by closing the mask — grow by a
 * radius, shrink back by the same radius. Nothing that already touches moves, and
 * everything narrower than the radius fills in:
 *
 * - "wrap" closes with the reach the gaps need, so the outline sweeps from one
 *   item to the next in one smooth curve, hugging both.
 * - "bridge" draws a thin neck along the shortest route first and closes with a
 *   small radius, which fillets the T-junction where the neck meets an item.
 * - a taut band arrives ready-made in `aJoin` and simply joins the mask.
 */
const offsetRings = (
    aRing: Point[][],
    r: number,
    oConnect: ConnectOptions | null,
    aJoin: Point[][] = []
): { aRing: Point[][]; step: number } => {
    const bBridge = oConnect?.mode === "bridge",
        // A wrap grows by its reach before shrinking back, so the bitmap has to
        // hold that much slack around the design.
        reach = oConnect?.mode === "wrap" ? Math.max(0.5, oConnect.reach || autoReach(aRing)) : 0,
        close = bBridge ? FILLET_MM : reach;

    const b = ringBounds([...aRing, ...aJoin]),
        margin = Math.abs(r) + close + (bBridge ? BRIDGE_MM / 2 : 0) + 1,
        boxW = b.x1 - b.x0 + margin * 2,
        boxH = b.y1 - b.y0 + margin * 2,
        pxPerMm = Math.min(OFFSET_PX_PER_MM, OFFSET_MAX_PX / Math.max(boxW, boxH)),
        w = Math.max(4, Math.ceil(boxW * pxPerMm)),
        h = Math.max(4, Math.ceil(boxH * pxPerMm));

    const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    canvas.width = w;
    canvas.height = h;
    const toPx = (p: Point): Point => ({
        x: (p.x - b.x0 + margin) * pxPerMm,
        y: (p.y - b.y0 + margin) * pxPerMm
    });

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";

    // Filled one ring at a time so overlapping items cannot cancel each other out
    // by winding. Holes are deliberately not punched: the plate under an item is
    // solid, and only its outer boundary is being traced.
    const fillRings = (aFill: Point[][]): void => {
        for (const ring of aFill) {
            ctx.beginPath();
            ring.forEach((p, i) => {
                const q = toPx(p);
                if (i) ctx.lineTo(q.x, q.y);
                else ctx.moveTo(q.x, q.y);
            });
            ctx.closePath();
            ctx.fill();
        }
    };
    const readMask = (): Uint8Array => {
        const data = ctx.getImageData(0, 0, w, h).data,
            m = new Uint8Array(w * h);
        for (let i = 0; i < m.length; i++) m[i] = data[i * 4 + 3]! >= 128 ? 1 : 0;
        return m;
    };

    // The items, with their border.
    fillRings(aRing);
    const mItem = offsetMask(readMask(), w, h, r * pxPerMm);

    // The same, plus whatever it takes to join them up.
    let mJoined: Uint8Array = mItem;
    if (bBridge) {
        ctx.clearRect(0, 0, w, h);
        ctx.lineWidth = BRIDGE_MM * pxPerMm;
        ctx.lineCap = "round";
        for (const oEdge of bridges(aRing)) {
            const p = toPx(oEdge.a),
                q = toPx(oEdge.b);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
        }
        const mNeck = readMask();
        mJoined = mItem.map((v, i) => (v || mNeck[i] ? 1 : 0));
    }
    if (close > 0) {
        const px = close * pxPerMm;
        mJoined = offsetMask(offsetMask(mJoined, w, h, px), w, h, -px);
    }
    if (aJoin.length) {
        ctx.clearRect(0, 0, w, h);
        fillRings(aJoin);
        const mBand = readMask();
        mJoined = mJoined.map((v, i) => (v || mBand[i] ? 1 : 0));
    }

    const { labels, aPiece } = findPieces(mJoined, w, h),
        iMinArea = Math.max(4, (0.4 * pxPerMm) ** 2),
        aOut = aPiece
            .filter(p => p.area >= iMinArea)
            .sort((x, y) => y.area - x.area)
            .map(p => simplifyRing(deStair(traceContour(labels, w, h, p)), 0.7)
                .map(q => ({ x: b.x0 - margin + q.x / pxPerMm, y: b.y0 - margin + q.y / pxPerMm })))
            .filter(a => a.length >= 3);

    if (!aOut.length) {
        throw new Error("Nothing left to cut — a negative border shrank the selection away. Raise it above 0 mm.");
    }
    return { aRing: aOut, step: 1 / pxPerMm };
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const r3 = (n: number): string => (Math.round(n * 1000) / 1000).toString();

const pathData = (aPts: Point[], bClose = true): string =>
    aPts.map((p, i) => `${i ? "L" : "M"}${r3(p.x)} ${r3(p.y)}`).join(" ") + (bClose ? " Z" : "");

const ringPathData = (aRing: Point[][]): string => aRing.map(a => pathData(a)).join(" ");

/** Drop points a curve flattener may have emitted twice. */
const dedupe = (aPts: Point[]): Point[] =>
    aPts.filter((p, i) => {
        const q = aPts[(i + aPts.length - 1) % aPts.length]!;
        return Math.abs(p.x - q.x) > 1e-4 || Math.abs(p.y - q.y) > 1e-4;
    });

export const buildOutline = (doc: OutlineDoc, o: OutlineOptions): OutlineResult => {
    const k = o.scale > 0 ? o.scale : 1,
        aSub: Subpath[] = k === 1
            ? doc.aSub
            : doc.aSub.map(s => ({ closed: s.closed, points: s.points.map(p => ({ x: p.x * k, y: p.y * k })) })),
        aItem = buildItems(aSub),
        // A design with a single item has nothing to pick, whatever was asked for.
        aSelected = aItem.length < 2 || !o.selection
            ? aItem.map((_, i) => i)
            : o.selection.filter(i => i >= 0 && i < aItem.length),
        aWarnings = [...doc.warnings];

    // The design, drawn item by item so the ones left out can be told apart.
    const bDesign = subBounds(aSub),
        sItems = aItem.map((it, i) => {
            const sD = it.aSubIdx.map(j => pathData(aSub[j]!.points, aSub[j]!.closed)).join(" "),
                sColor = aSelected.includes(i) ? ITEM_COLOR : MUTED_COLOR,
                sOpacity = aSelected.includes(i) ? "1" : "0.45";
            return { sD, sColor, sOpacity };
        });

    const previewSvg = (sExtra: string, box: Box, sw: number): string =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r3(box.x0)} ${r3(box.y0)} ${r3(box.x1 - box.x0)} ${r3(box.y1 - box.y0)}">`
        + sExtra
        + sItems.map(o2 => `<path d="${o2.sD}" fill="${o2.sColor}" fill-opacity="${o2.sOpacity}" fill-rule="evenodd"`
            + ` stroke="${o2.sColor}" stroke-opacity="${o2.sOpacity}" stroke-width="${r3(sw)}"/>`).join("");

    if (!aSelected.length) {
        // Nothing picked yet: the design is still drawn, so there is something to
        // click on.
        const sw = Math.max(0.05, (bDesign.x1 - bDesign.x0) / 500);
        return {
            svg: "",
            svgWithDesign: "",
            preview: previewSvg("", bDesign, sw) + "</svg>",
            width: 0,
            height: 0,
            pieces: 0,
            points: 0,
            accuracy: 0,
            autoReach: 0,
            aItem,
            aSelected,
            warnings: aWarnings
        };
    }

    if (aSelected.some(i => aItem[i]!.open)) {
        aWarnings.push("An outermost path in the selection is not closed — it was closed straight across to make a cut line.");
    }

    // One item has nothing to connect to, and a hull is exact geometry rather than
    // something the bitmap stage has to work out.
    const oConnect = aSelected.length > 1 ? o.connect : null,
        bHull = oConnect?.mode === "hull",
        aPick = aSelected.map(i => aItem[i]!.pts),
        // A taut band is exact geometry; the other two are worked out on the grid.
        aJoin = bHull ? [convexHull(aPick.flat())] : [];

    let aRing: Point[][],
        accuracy = 0,
        reachUsed = 0;
    if (Math.abs(o.border) < 0.001 && (!oConnect || bHull)) {
        // Nothing to compute: the contours are the cut lines, point for point.
        aRing = (bHull ? aJoin : aPick).map(dedupe);
    } else if (oConnect?.mode === "wrap" && !oConnect.reach) {
        // Automatic reach: start at half the widest gap and open up until the
        // selection really is one piece. Round and pointy shapes need more than
        // the geometry of the gap alone suggests.
        reachUsed = autoReach(aPick);
        let oOff = offsetRings(aPick, o.border, { mode: "wrap", reach: reachUsed }, aJoin);
        for (let i = 0; i < 5 && oOff.aRing.length > 1; i++) {
            reachUsed *= 1.7;
            oOff = offsetRings(aPick, o.border, { mode: "wrap", reach: reachUsed }, aJoin);
        }
        aRing = oOff.aRing;
        accuracy = oOff.step;
    } else {
        const oOff = offsetRings(aPick, o.border, oConnect, aJoin);
        aRing = oOff.aRing;
        accuracy = oOff.step;
        reachUsed = oConnect?.mode === "wrap" ? oConnect.reach ?? 0 : 0;
    }

    if (aRing.length > 1) {
        aWarnings.push(oConnect
            ? `Still ${aRing.length} separate cut lines — the connection does not reach across every gap yet.`
            : `${aRing.length} separate cut lines — connect the items (or widen the border until the gaps close) to get a single plate.`);
    }

    const vb = ringBounds(aRing),
        width = vb.x1 - vb.x0,
        height = vb.y1 - vb.y0,
        // Exported with the outline's own bounding box as the origin, so the file
        // is exactly as big as the piece to be cut.
        sPath = ringPathData(aRing.map(a => a.map(p => ({ x: p.x - vb.x0, y: p.y - vb.y0 })))),

        // The second export adds the traced items themselves, for a job that
        // engraves the design onto the plate it is cutting. Its box has to hold
        // both, since a negative border puts the cut line inside the design.
        aPicked = aSelected.flatMap(i => aItem[i]!.aSubIdx).map(j => aSub[j]!),
        bPicked = subBounds(aPicked),
        cx = Math.min(vb.x0, bPicked.x0),
        cy = Math.min(vb.y0, bPicked.y0),
        cw = Math.max(vb.x1, bPicked.x1) - cx,
        ch = Math.max(vb.y1, bPicked.y1) - cy,
        sDesignPath = aPicked
            .map(s => pathData(s.points.map(p => ({ x: p.x - cx, y: p.y - cy })), s.closed))
            .join(" "),
        sCutPath = ringPathData(aRing.map(a => a.map(p => ({ x: p.x - cx, y: p.y - cy })))),
        // The preview keeps the design's own coordinates and covers both the
        // geometry and a border sticking out of it.
        box: Box = {
            x0: Math.min(vb.x0, bDesign.x0),
            y0: Math.min(vb.y0, bDesign.y0),
            x1: Math.max(vb.x1, bDesign.x1),
            y1: Math.max(vb.y1, bDesign.y1)
        },
        sw = Math.max(0.05, (box.x1 - box.x0) / 500),
        sOutline = ringPathData(aRing);

    return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(width)}mm" height="${r3(height)}mm" viewBox="0 0 ${r3(width)} ${r3(height)}">`
            + `<path d="${sPath}" fill="none" stroke="${CUT_COLOR}" stroke-width="${EXPORT_STROKE}"/></svg>`,
        // The design goes in black: the operation types are not part of the
        // geometry the outline was traced from, so assigning one here would be a
        // guess. Only the cut line claims a colour, the one every laser tool reads
        // as cutting.
        svgWithDesign: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(cw)}mm" height="${r3(ch)}mm" viewBox="0 0 ${r3(cw)} ${r3(ch)}">`
            + `<path d="${sDesignPath}" fill="none" stroke="#000000" stroke-width="${EXPORT_STROKE}"/>`
            + `<path d="${sCutPath}" fill="none" stroke="${CUT_COLOR}" stroke-width="${EXPORT_STROKE}"/></svg>`,
        // Three layers, so the border reads as its own colour: the plate first,
        // the items on top of it (whatever the plate still shows around an item
        // *is* the border), then the cut line.
        preview: previewSvg(`<path d="${sOutline}" fill="${BORDER_COLOR}" fill-opacity="0.55"/>`, box, sw)
            + `<path d="${sOutline}" fill="none" stroke="${CUT_COLOR}" stroke-width="${r3(sw * 1.6)}"/></svg>`,
        width,
        height,
        pieces: aRing.length,
        points: aRing.reduce((n, a) => n + a.length, 0),
        accuracy,
        // The reach this outline came out of, so the slider can start there.
        autoReach: Math.round(reachUsed * 10) / 10,
        aItem,
        aSelected,
        warnings: aWarnings
    };
};
