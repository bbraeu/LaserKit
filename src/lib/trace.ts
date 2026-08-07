// The ESM source, not the package entry: skeleton-tracing-js declares
// `module: index.js` but never ships that file, so a bundler falls back to its
// UMD `main`, which touches `self` and throws the moment Astro renders the page
// in Node. This path is plain ESM and has no such wrapper.
import TraceSkeleton from "skeleton-tracing-js/trace_skeleton.vanilla.js";
import { distToSegment, pathData, r3, ringArea } from "./design";
import { OPERATION_COLORS, buildDxf, parsePathToPolylines } from "./dxf";
import type { DxfEntity, Operation, Point, Subpath } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Tracing a bitmap into vectors — LightBurn's "Bild nachzeichnen", in a page.
//
// Two modes, because a picture can mean two different things:
//
// - **Outline**: every dark region's boundary, holes included, as closed paths.
//   A filled logo comes out as shapes you can engrave or cut. This is what the
//   threshold / ignore / smooth / optimize sliders act on.
// - **Centreline**: the mask is peeled down to a one-pixel skeleton first, and
//   the skeleton's branches come out as open paths. A pen stroke becomes one line
//   down its middle instead of a closed outline around it.
//
// The slider names and defaults are LightBurn's, which are potrace's parameters
// under German labels: Ignoriere weniger als = turdsize, Glätte = alphamax
// (Smooth here), Optimieren = opttolerance (Optimize). The pipeline below
// follows the same published
// approach — decompose the bitmap into nested boundaries, reduce each to a
// polygon, then decide corner by corner whether to keep the corner or round it —
// but it is written from that description rather than ported, so none of
// potrace's own (GPL) code is in here.
// ---------------------------------------------------------------------------

/** Longest side the tracer works at. Beyond this the image is scaled down. */
const OUTLINE_MAX_PX = 1600;

/** Thinning is iterative, so centrelines get a tighter budget than outlines. */
const CENTERLINE_MAX_PX = 900;

/**
 * The normalised sagitta a corner may show at Glätte = 1 before it is rounded
 * instead of kept. Measured as the vertex's distance from the chord between its
 * two neighbours, over the length of that chord — a scale-free measure of
 * curvature, so it separates a square's corner (0.5, kept) from a vertex of a
 * finely sampled circle (below 0.1, rounded) whatever size either is drawn at.
 */
const BEND_AT_ONE = 0.25;

/** Below this the corner is straight enough to emit as a line. */
const BEND_FLAT = 0.002;

/**
 * The tolerance a traced boundary needs before it stops being a staircase.
 *
 * A lattice path along a 45° edge zig-zags half a pixel either side of the true
 * line, so node reduction has to be allowed at least that much or every step
 * survives as a node. Optimieren is added on top of it, which is why 0 is a
 * sensible setting rather than a useless one. Pre-smoothing the path instead
 * (a sliding average, as the contour tracer does) also works, but it rounds real
 * corners off: a rasterised square has to come out square.
 */
const STAIRCASE_TOL = 0.6;

/** Line width of a stroked export, in mm. */
const EXPORT_STROKE = 0.3;

/**
 * Above this share of the image being on the shape side, the polarity is probably
 * the wrong way round. Not certain — a design can be legitimately dark-heavy — so
 * it is a note with the figure in it rather than a refusal.
 */
const COVERAGE_SUSPECT = 0.85;

/** More preview nodes than this and drawing them all costs more than it shows. */
const MAX_SHOWN_POINTS = 3000;

export type TraceMode = "outline" | "centerline";

/** What the traced outlines are for: engraving the areas, or cutting the lines round them. */
export type TraceStyle = "fill" | "stroke";

export interface TraceImage {
    /** working size in pixels — the image, scaled down if it was over budget */
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
    /** the source's own pixel width, so 96 dpi means the size the image really is */
    sourceWidth: number;
    sourceHeight: number;
    /** the source as a data URL, for the faded backdrop under the preview */
    href: string;
    /** the mode the working size was budgeted for */
    mode: TraceMode;
}

export interface MaskOptions {
    mode: TraceMode;
    /** 0…255 — darker than this is shape (or, with `alpha`, more opaque than this) */
    threshold: number;
    /** swap which side of the threshold is the shape */
    invert: boolean;
    /** judge by the alpha channel instead of brightness */
    alpha: boolean;
}

export interface TraceOptions {
    /** ignore anything enclosing fewer than this many pixels */
    minArea: number;
    /** 0…1.334 — how much of a bend may be rounded off instead of kept as a corner */
    smooth: number;
    /** node-reduction tolerance, in pixels */
    optimize: number;
    /** centreline only: drop branches shorter than this many pixels */
    prune: number;
    /** outline only */
    style: TraceStyle;
    /** target width in mm; undefined = the source image's pixels at 96 dpi */
    widthMm?: number;
}

export interface TraceResult {
    /** the traced geometry as SVG path data, in millimetres, origin at 0,0 */
    d: string;
    /** the same flattened to polylines — what DXF and FDS are built from */
    aSub: Subpath[];
    /** every node of the traced paths, for the "show points" overlay */
    aNode: Point[];
    width: number;
    height: number;
    paths: number;
    nodes: number;
    /** how far the traced path may sit from the pixel edge it came from, in mm */
    accuracy: number;
    /** filled areas rather than lines */
    filled: boolean;
    /** the laser operation the export assigns */
    operation: Operation;
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Reading the image
// ---------------------------------------------------------------------------

/**
 * Decode a dropped image and hand back its pixels at the working size.
 *
 * The working size is capped: tracing is linear in the pixel count and thinning
 * runs over the whole bitmap once per pass, so a 6000 px photo would stall the
 * slider it is supposed to follow. The source's own size is kept so the physical
 * size still comes out as the image really is.
 */
export const readTraceImage = async (file: File, mode: TraceMode): Promise<TraceImage> => {
    const href = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("This file could not be read."));
        r.readAsDataURL(file);
    });

    let bmp: ImageBitmap;
    try {
        bmp = await createImageBitmap(file);
    } catch {
        throw new Error("This is not an image the browser can decode — PNG, JPEG, GIF, BMP and WebP all work.");
    }

    const sourceWidth = bmp.width,
        sourceHeight = bmp.height,
        budget = mode === "centerline" ? CENTERLINE_MAX_PX : OUTLINE_MAX_PX,
        k = Math.min(1, budget / Math.max(sourceWidth, sourceHeight)),
        width = Math.max(1, Math.round(sourceWidth * k)),
        height = Math.max(1, Math.round(sourceHeight * k));

    const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    canvas.width = width;
    canvas.height = height;
    // Left on transparent black: buildMask reads the alpha channel, so a
    // transparent background stays background rather than becoming solid black.
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close?.();

    const rgba = ctx.getImageData(0, 0, width, height).data;
    if (!rgba.length) throw new Error("This image has no pixels.");
    return { width, height, rgba, sourceWidth, sourceHeight, href, mode };
};

const LUMA = [0.2126, 0.7152, 0.0722];

/** Split the pixels into shape and background. */
const buildMask = (img: TraceImage, o: MaskOptions): Uint8Array => {
    const n = img.width * img.height,
        m = new Uint8Array(n),
        d = img.rgba;
    for (let i = 0; i < n; i++) {
        const j = i * 4,
            a = d[j + 3]!;
        let on: boolean;
        if (o.alpha) {
            on = a >= o.threshold;
        } else {
            // A transparent pixel has no colour to judge, so it counts as
            // background rather than as the black that undrawn canvas holds.
            on = a >= 8
                && LUMA[0]! * d[j]! + LUMA[1]! * d[j + 1]! + LUMA[2]! * d[j + 2]! < o.threshold;
        }
        m[i] = on !== o.invert ? 1 : 0;
    }
    return m;
};

// ---------------------------------------------------------------------------
// Boundary following
// ---------------------------------------------------------------------------

/**
 * Walk the boundary of the region containing a pixel, as a closed ring of pixel
 * corner coordinates.
 *
 * The walker sits on the corner lattice and reads the 2×2 pixels around the
 * current corner; that 4-bit state says where the boundary continues. The two
 * ambiguous diagonal states are resolved in favour of staying attached to the
 * diagonal, so a region touching only at a corner is traced as one piece.
 */
const traceBoundary = (
    at: (x: number, y: number) => number,
    sx: number,
    sy: number,
    limit: number
): Point[] => {
    const aPts: Point[] = [];
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
    } while ((cx !== sx || cy !== sy) && aPts.length < limit);

    return aPts;
};

/**
 * Flip every pixel a closed lattice path encloses.
 *
 * Even-odd by scanline: each vertical edge of the path toggles the pixels to its
 * right, out to the path's own right edge. Beyond the last crossing in a row the
 * toggles come in pairs and cancel, so stopping at the path's bounding box is
 * exact — and it keeps the cost to the region's own size instead of the image's
 * full width.
 */
const xorRegion = (work: Uint8Array, w: number, h: number, pts: Point[]): void => {
    let xMax = 0;
    for (const p of pts) if (p.x > xMax) xMax = p.x;

    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!,
            b = pts[(i + 1) % pts.length]!;
        if (a.x !== b.x) continue;
        const y0 = Math.min(a.y, b.y),
            y1 = Math.max(a.y, b.y);
        for (let y = y0; y < y1; y++) {
            if (y < 0 || y >= h) continue;
            const row = y * w;
            for (let x = a.x; x < xMax; x++) work[row + x] ^= 1;
        }
    }
};

export interface TraceRing {
    /** lattice corners, closed */
    pts: Point[];
    /** pixels enclosed */
    area: number;
}

/**
 * Every boundary in the bitmap, outer and hole alike.
 *
 * The first shape pixel in reading order starts a boundary; that boundary is
 * traced, then everything it encloses is flipped, so the next pass finds the next
 * level of nesting — a hole inside a shape, a shape inside that hole — until
 * nothing is left. Polarity never has to be recorded: with the even-odd fill rule
 * the alternation is exactly what nesting already means.
 */
const decompose = (mask: Uint8Array, w: number, h: number): TraceRing[] => {
    const work = Uint8Array.from(mask),
        aRing: TraceRing[] = [],
        limit = 4 * w * h + 8,
        at = (x: number, y: number): number =>
            x < 0 || y < 0 || x >= w || y >= h ? 0 : work[y * w + x]!;

    let from = 0;
    for (;;) {
        while (from < work.length && !work[from]) from++;
        if (from >= work.length) break;
        // The first set pixel in reading order has nothing set above or left of
        // it, so its top-left corner is on the boundary and the walk starts there
        // heading right.
        const pts = traceBoundary(at, from % w, (from / w) | 0, limit);
        if (pts.length < 4) {
            // Not a traceable boundary (a lone pixel the walker cannot circle);
            // clear it so the scan makes progress.
            work[from] = 0;
            continue;
        }
        xorRegion(work, w, h, pts);
        aRing.push({ pts, area: ringArea(pts) });
    }
    return aRing;
};

// ---------------------------------------------------------------------------
// The skeleton (centreline mode)
//
// Zhang–Suen thinning and the polyline extraction that follows it come from
// Lingdong Huang's skeleton-tracing-js (MIT) rather than from here: it is the
// published algorithm, already tested, and its divide-and-conquer chunking joins
// branch fragments into chains better than a plain graph walk does.
// ---------------------------------------------------------------------------

/** Rejoin ends that land within this many pixels of each other. */
const JOIN_PX = 1.5;

/** Chunk size the skeleton extractor splits on — the value its own helpers use. */
const SKELETON_CHUNK = 10;

const polyLength = (a: Point[]): number => {
    let s = 0;
    for (let i = 1; i < a.length; i++) s += Math.hypot(a[i]!.x - a[i - 1]!.x, a[i]!.y - a[i - 1]!.y);
    return s;
};

/**
 * Thin the mask and pull the skeleton out as polylines.
 *
 * The library thins in place and wants a plain array of 0/1, so the mask is copied
 * rather than handed over — the outline half and the coverage figure both still
 * need it intact.
 */
const traceSkeleton = (mask: Uint8Array, w: number, h: number): Point[][] => {
    return TraceSkeleton.trace(Array.from(mask), w, h, SKELETON_CHUNK)
        .polylines.map(a => a.map(([x, y]) => ({ x, y })));
};

/**
 * Chain the traced fragments back together where they meet.
 *
 * The extractor hands back a fragment per chunk boundary it split on, so a single
 * long stroke can arrive as several polylines meeting end to end. Left that way
 * each junction becomes a path end, which the curve fitter has to treat as a hard
 * corner — so ends that coincide are spliced first. Junctions where three or more
 * branches meet are left alone; there is no one chain through them.
 */
const chainFragments = (aPoly: Point[][]): Point[][] => {
    const aOpen = aPoly.filter(a => a.length >= 2).map(a => [...a]),
        near = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) <= JOIN_PX && Math.abs(p.y - q.y) <= JOIN_PX,
        endsOf = (a: Point[]): [Point, Point] => [a[0]!, a[a.length - 1]!];

    // How many other fragment ends sit at this point — a fork must not be spliced.
    const forkAt = (p: Point, skip: number): number => {
        let n = 0;
        aOpen.forEach((b, j) => {
            if (j === skip || !b.length) return;
            const [b0, b1] = endsOf(b);
            if (near(p, b0)) n++;
            if (near(p, b1)) n++;
        });
        return n;
    };

    for (let i = 0; i < aOpen.length; i++) {
        const a = aOpen[i]!;
        if (!a.length) continue;
        let joined = true;
        while (joined) {
            joined = false;
            const [a0, a1] = endsOf(a);
            for (let j = 0; j < aOpen.length; j++) {
                if (j === i) continue;
                const b = aOpen[j]!;
                if (!b.length) continue;
                const [b0, b1] = endsOf(b);
                // Only a plain end-to-end meeting: at a fork, splicing two of the
                // branches would invent a corner that is not in the drawing.
                const at = (p: Point): boolean => forkAt(p, i) === 1;
                if (near(a1, b0) && at(a1)) { a.push(...b.slice(1)); }
                else if (near(a1, b1) && at(a1)) { a.push(...[...b].reverse().slice(1)); }
                else if (near(a0, b1) && at(a0)) { a.unshift(...b.slice(0, -1)); }
                else if (near(a0, b0) && at(a0)) { a.unshift(...[...b].reverse().slice(0, -1)); }
                else continue;
                b.length = 0;
                joined = true;
                break;
            }
        }
    }
    return aOpen.filter(a => a.length >= 2);
};

// ---------------------------------------------------------------------------
// Polygon reduction and curve fitting
// ---------------------------------------------------------------------------

/**
 * Douglas–Peucker over one open run, reporting how far it strayed — so the tool
 * can say what the traced path is worth instead of repeating the tolerance back.
 */
const dpRun = (aPts: Point[], tol: number): { pts: Point[]; error: number } => {
    const n = aPts.length;
    if (n < 3) return { pts: aPts.slice(), error: 0 };
    const keep = new Uint8Array(n),
        aStack: [number, number][] = [[0, n - 1]];
    keep[0] = 1;
    keep[n - 1] = 1;
    let error = 0;
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
        } else if (dFar > error) {
            error = dFar;
        }
    }
    return { pts: aPts.filter((_, i) => keep[i]), error };
};

/**
 * Reduce a traced path to its polygon.
 *
 * A ring is cut at its two extremes and each half reduced on its own. Running the
 * open reduction straight down a ring's point list instead would pin the list's
 * last point — which on a closed boundary sits one pixel from the first — and that
 * near-duplicate is enough to make a real corner measure as smooth, so a
 * rasterised square would come out with one rounded corner.
 */
const simplifyMeasured = (aPts: Point[], tol: number, bClosed: boolean): { pts: Point[]; error: number } => {
    if (!bClosed) return dpRun(aPts, tol);

    const n = aPts.length;
    if (n < 8) return { pts: aPts.slice(), error: 0 };
    const p0 = aPts[0]!;
    let iFar = 0,
        dFar = -1;
    aPts.forEach((p, i) => {
        const d = (p.x - p0.x) ** 2 + (p.y - p0.y) ** 2;
        if (d > dFar) { dFar = d; iFar = i; }
    });
    const a = dpRun(aPts.slice(0, iFar + 1), tol),
        b = dpRun([...aPts.slice(iFar), p0], tol);
    return {
        pts: [...a.pts.slice(0, -1), ...b.pts.slice(0, -1)],
        error: Math.max(a.error, b.error)
    };
};

/**
 * Drop vertices that sit on top of one another.
 *
 * Node reduction can leave two vertices a fraction of a pixel apart, and a
 * neighbour that close carries no direction: the corner test would read the bend
 * across it as nothing and round off a corner that is really there.
 */
const collapse = (aPts: Point[], near: number, bClosed: boolean): Point[] => {
    const out: Point[] = [];
    for (const p of aPts) {
        const q = out[out.length - 1];
        if (q && Math.hypot(p.x - q.x, p.y - q.y) < near) continue;
        out.push(p);
    }
    if (bClosed && out.length > 2) {
        const first = out[0]!,
            last = out[out.length - 1]!;
        if (Math.hypot(first.x - last.x, first.y - last.y) < near) out.pop();
    }
    return out;
};

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** How sharply the path turns at b, as a fraction of the chord it cuts across. */
const bendAt = (a: Point, b: Point, c: Point): number => {
    const chord = Math.hypot(c.x - a.x, c.y - a.y);
    if (chord < 1e-9) return Infinity; // doubles straight back: as sharp as it gets
    return distToSegment(b, a, c) / chord;
};

/**
 * A cubic through the corner at b, tangent to both segments where it leaves and
 * arrives. Control points two thirds of the way from each midpoint towards b is
 * the quadratic with b as its control point, raised to a cubic — the plain
 * parabolic rounding of a corner.
 */
const corner = (b: Point, from: Point, to: Point): string => {
    const c1 = { x: from.x + (2 / 3) * (b.x - from.x), y: from.y + (2 / 3) * (b.y - from.y) },
        c2 = { x: to.x + (2 / 3) * (b.x - to.x), y: to.y + (2 / 3) * (b.y - to.y) };
    return `C${r3(c1.x)} ${r3(c1.y)} ${r3(c2.x)} ${r3(c2.y)} ${r3(to.x)} ${r3(to.y)}`;
};

interface Fitted {
    d: string;
    /** every anchor of the path — what a node editor would put a handle on */
    nodes: Point[];
}

/** What the path does at a vertex: pass straight through, round it, or keep it. */
type Kind = "flat" | "round" | "corner";

/**
 * Which vertices are corners.
 *
 * The bend at a vertex, against the Glätte setting: a rasterised circle's vertices
 * barely bend relative to the chord they cut and become curves, while a rasterised
 * square's 90° turns bend far too much and stay square. A vertex that hardly bends
 * at all is on a straight run and can go entirely.
 */
const classify = (v: Point[], smooth: number, bClosed: boolean): Kind[] => {
    const n = v.length,
        bendMax = smooth * BEND_AT_ONE;
    return v.map((b, i) => {
        // An open branch's two ends are real ends, not turns in a path.
        if (!bClosed && (i === 0 || i === n - 1)) return "corner";
        const a = v[(i + n - 1) % n]!,
            c = v[(i + 1) % n]!,
            bend = bendAt(a, b, c);
        return bend < BEND_FLAT ? "flat" : bend <= bendMax ? "round" : "corner";
    });
};

/**
 * Turn a polygon into a path.
 *
 * A rounded vertex is cut across from the midpoint of one edge to the midpoint of
 * the next along a curve; a corner is run into and out of directly. The midpoints
 * only exist to give a curve somewhere to start and end, so between two corners
 * they are skipped — otherwise every straight edge would carry a pointless node
 * halfway along it, and a traced square would report eight nodes instead of four.
 */
const fitRing = (v: Point[], smooth: number): Fitted => {
    const n = v.length;
    if (n < 3) return { d: "", nodes: [] };

    const aKind = classify(v, smooth, true),
        keep = v.filter((_, i) => aKind[i] !== "flat"),
        m = keep.length;
    if (m < 2) return { d: "", nodes: [] };
    // Re-classified on the surviving vertices, so a dropped straight-run vertex
    // cannot leave its neighbours judging the bend across a point that is gone.
    const aK = classify(keep, smooth, true),
        aOut: string[] = [],
        aNode: Point[] = [],
        start = aK[0] === "round" ? mid(keep[m - 1]!, keep[0]!) : keep[0]!;

    aOut.push(`M${r3(start.x)} ${r3(start.y)}`);
    aNode.push(start);

    for (let i = 0; i < m; i++) {
        const a = keep[(i + m - 1) % m]!,
            b = keep[i]!,
            c = keep[(i + 1) % m]!;
        if (aK[i] === "round") {
            const from = mid(a, b);
            // Coming out of a corner the path sits on `a`, so it has to run up the
            // edge to where the curve begins; coming out of a curve it is there.
            if (i > 0 && aK[i - 1] !== "round") {
                aOut.push(`L${r3(from.x)} ${r3(from.y)}`);
                aNode.push(from);
            }
            const to = mid(b, c);
            aOut.push(corner(b, from, to));
            aNode.push(to);
        } else if (i > 0) {
            aOut.push(`L${r3(b.x)} ${r3(b.y)}`);
            aNode.push(b);
        }
        // i === 0 as a corner needs nothing: the path was started on it, and Z
        // brings the last edge back to it.
    }
    aOut.push("Z");
    return { d: aOut.join(" "), nodes: aNode };
};

/** The same for an open branch, which keeps its two real ends. */
const fitOpen = (v: Point[], smooth: number): Fitted => {
    const n = v.length;
    if (n < 2) return { d: "", nodes: [] };
    if (n === 2) return { d: pathData(v, false), nodes: [v[0]!, v[1]!] };

    const aKind = classify(v, smooth, false),
        keep = v.filter((_, i) => aKind[i] !== "flat"),
        m = keep.length;
    if (m < 2) return { d: "", nodes: [] };
    const aK = classify(keep, smooth, false),
        aOut = [`M${r3(keep[0]!.x)} ${r3(keep[0]!.y)}`],
        aNode: Point[] = [keep[0]!];

    for (let i = 1; i < m - 1; i++) {
        const a = keep[i - 1]!,
            b = keep[i]!,
            c = keep[i + 1]!;
        if (aK[i] === "round") {
            // The branch's own ends are real points, not midpoints of an edge.
            const from = i === 1 ? a : mid(a, b),
                to = i === m - 2 ? c : mid(b, c);
            if (i > 1 && aK[i - 1] !== "round") {
                aOut.push(`L${r3(from.x)} ${r3(from.y)}`);
                aNode.push(from);
            }
            aOut.push(corner(b, from, to));
            aNode.push(to);
        } else {
            aOut.push(`L${r3(b.x)} ${r3(b.y)}`);
            aNode.push(b);
        }
    }

    // The far end is only reached already when the last turn curved into it.
    const last = keep[m - 1]!,
        at = aNode[aNode.length - 1]!;
    if (Math.hypot(at.x - last.x, at.y - last.y) > 1e-6) {
        aOut.push(`L${r3(last.x)} ${r3(last.y)}`);
        aNode.push(last);
    }
    return { d: aOut.join(" "), nodes: aNode };
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * The expensive half of a trace: everything that depends only on the threshold.
 *
 * Kept apart from the rest so that dragging Glätte or Optimieren re-fits curves
 * to an already-decomposed bitmap instead of re-thresholding two million pixels —
 * and, in centreline mode, instead of thinning them all over again.
 */
export interface TracePrep {
    mode: TraceMode;
    width: number;
    height: number;
    /** outline mode: every boundary in the bitmap */
    aRing: TraceRing[];
    /** centreline mode: the skeleton's branches, before the short ones are dropped */
    aBranch: Point[][];
    /** share of the image the mask covers, 0…1 */
    coverage: number;
}

export const prepareTrace = (img: TraceImage, o: MaskOptions): TracePrep => {
    const mask = buildMask(img, o),
        { width, height } = img;

    let on = 0;
    for (let i = 0; i < mask.length; i++) on += mask[i]!;

    if (o.mode === "centerline") {
        return {
            mode: o.mode,
            width,
            height,
            aRing: [],
            aBranch: chainFragments(traceSkeleton(mask, width, height)),
            coverage: on / mask.length
        };
    }
    return {
        mode: o.mode,
        width,
        height,
        aRing: decompose(mask, width, height),
        aBranch: [],
        coverage: on / mask.length
    };
};

const OPERATIONS: Record<string, Operation> = {
    fill: OPERATION_COLORS.FILL_VECTOR_ENGRAVING!,
    stroke: OPERATION_COLORS.VECTOR_CUTTING!,
    centerline: OPERATION_COLORS.VECTOR_ENGRAVING!
};

export const buildTrace = (img: TraceImage, prep: TracePrep, o: TraceOptions): TraceResult => {
    const aWarnings: string[] = [],
        // 96 dpi on the source image's own pixels, so an image scaled down for the
        // tracer still comes out the size it really is.
        mmPerSourcePx = o.widthMm && o.widthMm > 0 ? o.widthMm / img.sourceWidth : 25.4 / 96,
        k = mmPerSourcePx * (img.sourceWidth / img.width),
        tol = STAIRCASE_TOL + Math.max(0, o.optimize),
        bCenter = prep.mode === "centerline",
        bFilled = !bCenter && o.style === "fill";

    if (img.sourceWidth > img.width) {
        aWarnings.push(`This image is ${img.sourceWidth}×${img.sourceHeight} px and was traced at ${img.width}×${img.height} — the working size keeps the sliders responsive. Its physical size is unaffected.`);
    }
    if (prep.coverage > COVERAGE_SUSPECT) {
        aWarnings.push(`${Math.round(prep.coverage * 100)} % of this image is on the shape side of the threshold, so nearly all of it would be worked. If the artwork is the light part, turn on invert; otherwise move Schwelle.`);
    }

    const aSource: { pts: Point[]; closed: boolean }[] = bCenter
        ? prep.aBranch.filter(a => o.prune <= 0 || polyLength(a) >= o.prune).map(pts => ({ pts, closed: false }))
        : prep.aRing
            .filter(r => r.area >= o.minArea)
            .map(r => ({ pts: r.pts, closed: true }));

    const iDropped = (bCenter ? prep.aBranch.length : prep.aRing.length) - aSource.length;
    if (iDropped > 0) {
        aWarnings.push(bCenter
            ? `${iDropped} ${iDropped === 1 ? "branch" : "branches"} shorter than ${o.prune} px were dropped — thinning leaves a barb wherever the edge of a stroke bulges.`
            : `${iDropped} ${iDropped === 1 ? "shape" : "shapes"} smaller than ${o.minArea} px were ignored.`);
    }
    if (!aSource.length) {
        throw new Error(bCenter
            ? "Nothing left after thinning — move the Schwelle slider, or lower the branch length."
            : "Nothing crossed the threshold. Move Schwelle, turn on invert, or lower “ignore smaller than”.");
    }

    const aD: string[] = [],
        aNode: Point[] = [];
    let error = 0,
        nodes = 0;

    for (const src of aSource) {
        const simple = simplifyMeasured(src.pts, tol, src.closed),
            v = collapse(simple.pts, tol * 0.75, src.closed).map(p => ({ x: p.x * k, y: p.y * k })),
            fit = src.closed ? fitRing(v, o.smooth) : fitOpen(v, o.smooth);
        if (!fit.d) continue;
        aD.push(fit.d);
        aNode.push(...fit.nodes);
        nodes += fit.nodes.length;
        if (simple.error > error) error = simple.error;
    }

    if (!aD.length) throw new Error("Nothing traceable came out of this image at these settings.");

    const d = aD.join(" "),
        aSub = parsePathToPolylines(d),
        width = img.width * k,
        height = img.height * k;

    if (aNode.length > MAX_SHOWN_POINTS) {
        aWarnings.push(`${aNode.length} nodes — too many to draw them all, so the overlay shows none. Raise Optimize to bring the count down.`);
    }

    return {
        d,
        aSub,
        aNode: aNode.length > MAX_SHOWN_POINTS ? [] : aNode,
        width,
        height,
        paths: aD.length,
        nodes,
        // What node reduction actually gave up, measured rather than assumed.
        // Rounding a corner can move the curve further; the copy says so.
        accuracy: error * k,
        filled: bFilled,
        operation: OPERATIONS[bCenter ? "centerline" : o.style]!,
        warnings: aWarnings
    };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const traceToSvg = (r: TraceResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + `<path d="${r.d}" ${r.filled
        ? `fill="${r.operation.css}" fill-rule="evenodd"`
        : `fill="none" stroke="${r.operation.css}" stroke-width="${EXPORT_STROKE}"`}/>`
    + "</svg>";

export const traceToDxf = (r: TraceResult): string => {
    const aEntity: DxfEntity[] = r.aSub
        .filter(s => s.points.length >= 2)
        .map(s => ({
            color: r.operation.color,
            closed: s.closed,
            points: s.points.map(p => ({ x: p.x, y: r.height - p.y })) // DXF y grows upward
        }));
    return buildDxf(aEntity);
};

export const traceToFds = (r: TraceResult): Promise<Blob> => {
    const mode = r.filled ? 0 : r.operation === OPERATIONS.stroke ? 2 : 1;
    // Filled shapes go out as one shape holding every ring, so the odd-even rule a
    // QPainterPath applies keeps the holes; lines go out one shape each.
    return buildFds(r.filled
        ? [{ mode, subpaths: r.aSub }]
        : r.aSub.map(s => ({ mode, subpaths: [s] })));
};
