import { getCanvasGeometry, getLocalGeometry } from "./convert";
import { operationForCss } from "./dxf";
import type { XcsProject } from "./convert";
import { FLATTEN_TOLERANCE } from "./dxf";
import type { Point, Subpath } from "./dxf";
import { isXsArchive, parseXs } from "./xs";

// ---------------------------------------------------------------------------
// Reading a dropped design into millimetre geometry.
//
// Every tool in the kit starts here: an .svg, .xcs or .xs file becomes one
// DesignDoc per canvas, holding the design's subpaths in millimetres with curves
// already flattened. .xcs/.xs projects go through the very same extraction the
// DXF export uses, so a tool always works on exactly what would be cut.
// ---------------------------------------------------------------------------

/** CSS px per millimetre — the 96 dpi every SVG importer falls back to. */
export const PX_PER_MM = 96 / 25.4;

export const SVG_NS = "http://www.w3.org/2000/svg";

/** Subpaths enclosing less than this are noise, not shapes or holes (mm²). */
export const MIN_RING_AREA = 0.01;

export interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface DesignDoc {
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

// ---------------------------------------------------------------------------
// Geometry helpers shared by the tools
// ---------------------------------------------------------------------------

export const subBounds = (aSub: Subpath[]): Box => {
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

export const ringBounds = (aRing: Point[][]): Box =>
    subBounds(aRing.map(a => ({ points: a, closed: true })));

/** Signed-area magnitude of a ring; also weeds out degenerate subpaths. */
export const ringArea = (a: Point[]): number => {
    let s = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
        s += a[j]!.x * a[i]!.y - a[i]!.x * a[j]!.y;
    }
    return Math.abs(s) / 2;
};

/** Even-odd ray cast: is the point inside the ring? */
export const inRing = (p: Point, a: Point[]): boolean => {
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

export const boxInside = (a: Box, b: Box): boolean =>
    a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

export const boxOverlaps = (a: Box, b: Box): boolean =>
    a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Three decimals is 1 µm — far below any laser spot, and keeps files small. */
export const r3 = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export const pathData = (aPts: Point[], bClose = true): string =>
    aPts.map((p, i) => `${i ? "L" : "M"}${r3(p.x)} ${r3(p.y)}`).join(" ") + (bClose ? " Z" : "");

export const ringPathData = (aRing: Point[][]): string => aRing.map(a => pathData(a)).join(" ");

/** Drop points a curve flattener may have emitted twice. */
export const dedupe = (aPts: Point[]): Point[] =>
    aPts.filter((p, i) => {
        const q = aPts[(i + aPts.length - 1) % aPts.length]!;
        return Math.abs(p.x - q.x) > 1e-4 || Math.abs(p.y - q.y) > 1e-4;
    });

/**
 * Sliding average over the ring, three points wide: enough to take the 1 px
 * staircase off a traced boundary, far too little to round a corner. Not a design
 * knob — the exported contour is meant to be the offset, not a prettier curve.
 */
export const deStair = (aPts: Point[]): Point[] => {
    const n = aPts.length;
    if (n < 8) return aPts;
    return aPts.map((_, i) => {
        const a = aPts[(i + n - 1) % n]!, b = aPts[i]!, c = aPts[(i + 1) % n]!;
        return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    });
};

// ---------------------------------------------------------------------------
// Primitives — rectangles, circles and ellipses as rings
//
// Flattened to the same tolerance the curve flattener works at, so a generated
// shape is no coarser than one that came out of a design file.
// ---------------------------------------------------------------------------

/** Segments a circular arc of `sweep` radians needs to stay within tolerance. */
export const arcSegments = (r: number, sweep: number): number =>
    r <= FLATTEN_TOLERANCE
        ? 2
        : Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(0, 1 - FLATTEN_TOLERANCE / r)))));

/** A rectangle with optional rounded corners, clockwise from the top-left. */
export const rectRing = (b: Box, radius: number): Point[] => {
    const w = b.x1 - b.x0,
        h = b.y1 - b.y0,
        r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));

    if (r < 1e-6) {
        return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
    }

    const segs = arcSegments(r, Math.PI / 2),
        out: Point[] = [],
        // Centre of each corner arc, with the angle its sweep starts at.
        aCorner: [number, number, number][] = [
            [b.x1 - r, b.y0 + r, -Math.PI / 2], // top-right
            [b.x1 - r, b.y1 - r, 0],            // bottom-right
            [b.x0 + r, b.y1 - r, Math.PI / 2],  // bottom-left
            [b.x0 + r, b.y0 + r, Math.PI]       // top-left
        ];

    for (const [cx, cy, a0] of aCorner) {
        for (let i = 0; i <= segs; i++) {
            const a = a0 + (Math.PI / 2) * (i / segs);
            out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
    }
    return dedupe(out);
};

/** An ellipse, clockwise. */
export const ellipseRing = (cx: number, cy: number, rx: number, ry: number): Point[] => {
    const segs = arcSegments(Math.max(rx, ry), 2 * Math.PI),
        out: Point[] = [];
    for (let i = 0; i < segs; i++) {
        const a = (2 * Math.PI * i) / segs;
        out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return out;
};

export const circleRing = (cx: number, cy: number, r: number): Point[] => ellipseRing(cx, cy, r, r);

/** The same ring somewhere else. */
export const shiftRing = (a: Point[], dx: number, dy: number): Point[] =>
    a.map(p => ({ x: p.x + dx, y: p.y + dy }));

export interface Placement {
    /** where this item's bounding box goes */
    x: number;
    y: number;
    w: number;
    h: number;
    /** turned a quarter turn, so w and h are the source's h and w */
    turned: boolean;
}

/**
 * Shelf packing: rows across a sheet, then down.
 *
 * Not the best packing there is — cutting an outline into another outline's
 * concavity would beat it every time — but real nesting of arbitrary contours
 * is NP-hard, and the honest trade is stated wherever this is used rather than
 * hidden behind a progress bar. Bounding boxes in rows is what a person does by
 * hand, and it is within a few per cent of that for the parts a laser cuts.
 *
 * Items are placed in the order given. A part wider than the sheet widens the
 * layout rather than vanishing off it, and the caller is told how many.
 */
export const shelfPack = (
    aSize: { w: number; h: number }[],
    sheet: number,
    gap: number,
    /** a portrait item may be laid on its side if that fits the row better */
    bTurn = false
): { aPlaced: Placement[]; width: number; height: number; over: number } => {
    const over = aSize.filter(o => Math.min(o.w, bTurn ? o.h : o.w) > sheet).length,
        wMax = Math.max(sheet, ...aSize.map(o => (bTurn ? Math.min(o.w, o.h) : o.w)));

    let x = 0, y = 0, hRow = 0, wUsed = 0;
    const aPlaced = aSize.map(o => {
        // Turned only when it is the difference between fitting this row and
        // starting a new one: rotating for its own sake makes a sheet no
        // smaller and makes the grain run four ways.
        const turned = bTurn && o.h < o.w && x > 0 && x + o.w > wMax + 1e-6 && x + o.h <= wMax + 1e-6,
            w = turned ? o.h : o.w,
            h = turned ? o.w : o.h;
        if (x > 0 && x + w > wMax + 1e-6) {
            x = 0;
            y += hRow + gap;
            hRow = 0;
        }
        const out: Placement = { x, y, w, h, turned };
        x += w + gap;
        hRow = Math.max(hRow, h);
        wUsed = Math.max(wUsed, x - gap);
        return out;
    });

    return { aPlaced, width: wUsed, height: y + hRow, over };
};

export const distToSegment = (p: Point, a: Point, b: Point): number => {
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
export const simplifyOpen = (aPts: Point[], tol: number): Point[] => {
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
export const simplifyRing = (aPts: Point[], tol: number): Point[] => {
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

// ---------------------------------------------------------------------------
// SVG input
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
            aWarnings.push("Text in this SVG was ignored — convert it to paths first, or it will be missing from the result.");
        }
        svg.querySelectorAll<SVGGraphicsElement>("path,rect,circle,ellipse,line,polygon,polyline,image").forEach(el => {
            const m = el.getCTM();
            if (!m) return;
            // Read off the element rather than the file's markup, so a colour
            // set by a class, by a parent group or by presentation attribute
            // all arrive the same way.
            const style = getComputedStyle(el),
                operation = operationForCss(style.fill, style.stroke);
            getLocalGeometry(el).forEach(sub => {
                if (sub.points.length < 2) return;
                aSub.push({
                    closed: sub.closed,
                    operation,
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

const makeDoc = (title: string, aSub: Subpath[], assumed: boolean, warnings: string[]): DesignDoc => {
    const b = subBounds(aSub);
    return { title, aSub, width: b.x1 - b.x0, height: b.y1 - b.y0, assumed, warnings };
};

/**
 * Read a dropped file into one design per canvas. What "empty" means is the
 * caller's business, so the two messages a tool would word differently are
 * parameters rather than fixed text.
 */
export const readDesignFile = async (
    file: File,
    sEmptyProject = "This project has no geometry to work with.",
    sEmptySvg = "This SVG holds no geometry to work with."
): Promise<{ name: string; aDoc: DesignDoc[] }> => {
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
        if (!aDoc.length) throw new Error(sEmptyProject);
        return { name, aDoc };
    }

    const doc = parseSvgDoc(sText),
        { aSub, warnings } = extractSvgGeometry(doc);
    if (!aSub.length) throw new Error(sEmptySvg);
    return { name, aDoc: [makeDoc("Design", aSub, doc.assumed, warnings)] };
};

/** The design at a different size — for an SVG whose physical size had to be guessed. */
export const scaleSubpaths = (aSub: Subpath[], k: number): Subpath[] =>
    k === 1
        ? aSub
        : aSub.map(s => ({ closed: s.closed, points: s.points.map(p => ({ x: p.x * k, y: p.y * k })) }));
