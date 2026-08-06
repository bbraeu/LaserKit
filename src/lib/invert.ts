import {
    MIN_RING_AREA, boxInside, boxOverlaps, dedupe, inRing, pathData, r3,
    readDesignFile, ringArea, ringBounds, ringPathData, scaleSubpaths, subBounds
} from "./design";
import type { Box, DesignDoc } from "./design";
import { FLATTEN_TOLERANCE, OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Point, Subpath } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Inverting a design: what was filled comes out empty, what was empty comes out
// filled.
//
// The use case is a stamp. A stamp prints the parts that stand proud, so the
// laser has to remove everything *around* the artwork — the exact opposite of
// engraving the artwork itself. Same operation makes stencils, inlays, and any
// "engrave the background" plate.
//
// It is done as exact geometry, not on a bitmap. A design's filled area is
// already defined by nesting: a shape's outermost ring is filled, a ring inside
// it is a hole, a ring inside that is filled again — which is precisely the
// even-odd fill rule. So adding one more ring *around* everything shifts every
// region up one level of nesting and flips it: the plate becomes filled, each
// shape becomes a hole in it, and the counter of an "o" becomes solid again.
//
// The whole inversion is therefore a single path — the frame followed by every
// ring of the design — drawn even-odd. Nothing is resampled, nothing is
// approximated, and the output is accurate to the 0.01 mm the curve flattener
// worked to. DXF has no fills, but laser software fills nested closed contours
// by the same alternating rule, and an .fds shape is a QPainterPath, whose
// default rule is odd-even as well.
// ---------------------------------------------------------------------------

/** The plate is engraved away, so it is surface engraving; its edge is a cut. */
const ENGRAVE = OPERATION_COLORS.FILL_VECTOR_ENGRAVING!;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;

/** Line width of an exported cut path, in mm. */
const EXPORT_STROKE = 0.3;

/** Corner arcs and ellipses are flattened to the same tolerance as the input. */
const ARC_TOLERANCE = FLATTEN_TOLERANCE;

/** Above this many segment pairs the shapes-overlap check gives up (a warning only). */
const CROSS_BUDGET = 4e6;

/** Shape of the plate the design is subtracted from. */
export type FrameShape = "rect" | "ellipse" | "circle";

/** Mirroring: a stamp has to be engraved back-to-front to print the right way. */
export type MirrorAxis = "none" | "h" | "v";

export interface InvertOptions {
    frame: FrameShape;
    /** millimetres of plate around the design on every side */
    margin: number;
    /** corner radius in mm — rectangular plates only */
    radius: number;
    mirror: MirrorAxis;
    /** multiplier on the geometry, for an SVG whose physical size had to be guessed */
    scale: number;
    /** also emit the plate's edge as a cut line, to free the stamp from the sheet */
    cut: boolean;
}

export interface InvertResult {
    /** the plate's edge, origin at 0,0 — the outer ring of the inverted figure */
    frame: Point[];
    /** the design's rings in the same coordinates: the parts left standing */
    aRing: Point[][];
    /** plate size in mm */
    width: number;
    height: number;
    /** rings punched through the plate */
    shapes: number;
    points: number;
    /** share of the plate that gets engraved away, 0…1 */
    engraved: number;
    /** the plate edge is also exported as a cut line */
    cut: boolean;
    /** on-screen preview: engraved area filled, the parts left standing showing through */
    preview: string;
    warnings: string[];
}

/** Read a dropped design for inverting — the same reader every tool uses. */
export const readInvertFile = (file: File): Promise<{ name: string; aDoc: DesignDoc[] }> =>
    readDesignFile(
        file,
        "This project has no geometry to invert.",
        "This SVG holds no geometry to invert."
    );

// ---------------------------------------------------------------------------
// The plate
// ---------------------------------------------------------------------------

/** Segments a circular arc of `sweep` radians needs to stay within tolerance. */
const arcSegments = (r: number, sweep: number): number =>
    r <= ARC_TOLERANCE
        ? 2
        : Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(0, 1 - ARC_TOLERANCE / r)))));

/** A rectangle with optional rounded corners, clockwise from the top-left. */
const rectRing = (b: Box, radius: number): Point[] => {
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
const ellipseRing = (cx: number, cy: number, rx: number, ry: number): Point[] => {
    const segs = arcSegments(Math.max(rx, ry), 2 * Math.PI),
        out: Point[] = [];
    for (let i = 0; i < segs; i++) {
        const a = (2 * Math.PI * i) / segs;
        out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return out;
};

interface Frame {
    ring: Point[];
    /** is the point on or inside the plate? Closed form, so it is cheap per point. */
    holds: (p: Point) => boolean;
}

/**
 * The plate around a design. A rectangle is the design's bounding box grown by
 * the margin; an ellipse has to circumscribe that box, so its semi-axes are the
 * box's half-sides times √2 — the smallest ellipse of the same proportions that
 * still contains every corner.
 */
const buildFrame = (bDesign: Box, o: InvertOptions): Frame => {
    const m = Math.max(0, o.margin),
        cx = (bDesign.x0 + bDesign.x1) / 2,
        cy = (bDesign.y0 + bDesign.y1) / 2,
        hw = (bDesign.x1 - bDesign.x0) / 2,
        hh = (bDesign.y1 - bDesign.y0) / 2;

    if (o.frame === "rect") {
        const box: Box = { x0: bDesign.x0 - m, y0: bDesign.y0 - m, x1: bDesign.x1 + m, y1: bDesign.y1 + m },
            r = Math.max(0, Math.min(o.radius, Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2)),
            // Distance from the box's inner corner rectangle — zero inside it,
            // so the test collapses to the plain box when r is 0.
            ihw = (box.x1 - box.x0) / 2 - r,
            ihh = (box.y1 - box.y0) / 2 - r,
            fcx = (box.x0 + box.x1) / 2,
            fcy = (box.y0 + box.y1) / 2;
        return {
            ring: rectRing(box, r),
            holds: p => {
                const dx = Math.abs(p.x - fcx),
                    dy = Math.abs(p.y - fcy);
                if (dx > ihw + r + 1e-9 || dy > ihh + r + 1e-9) return false;
                const ox = Math.max(0, dx - ihw),
                    oy = Math.max(0, dy - ihh);
                return ox * ox + oy * oy <= r * r + 1e-9;
            }
        };
    }

    // An ellipse of the box's own proportions passes through all four corners at
    // exactly √2 times its half-sides; a circle has to reach the corner outright,
    // which is the box's half-diagonal.
    const rCircle = Math.hypot(hw, hh) + m,
        ax = o.frame === "circle" ? rCircle : hw * Math.SQRT2 + m,
        ay = o.frame === "circle" ? rCircle : hh * Math.SQRT2 + m;

    return {
        ring: ellipseRing(cx, cy, ax, ay),
        holds: p => ((p.x - cx) / ax) ** 2 + ((p.y - cy) / ay) ** 2 <= 1 + 1e-9
    };
};

// ---------------------------------------------------------------------------
// The design's rings
// ---------------------------------------------------------------------------

interface Ring {
    pts: Point[];
    box: Box;
    area: number;
    /** came from an open subpath and had to be closed straight across */
    open: boolean;
    /** rings of the design containing this one — even = filled, odd = a hole */
    depth: number;
}

/** Do the two segments properly cross? Merely touching does not count. */
const segsCross = (p1: Point, p2: Point, p3: Point, p4: Point): boolean => {
    const side = (a: Point, b: Point, c: Point): number =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = side(p3, p4, p1),
        d2 = side(p3, p4, p2),
        d3 = side(p1, p2, p3),
        d4 = side(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
        && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/** Does any edge of one ring cross an edge of the other? */
const ringsCross = (a: Point[], b: Point[]): boolean => {
    for (let i = 0, n = a.length; i < n; i++) {
        const a1 = a[i]!, a2 = a[(i + 1) % n]!;
        for (let j = 0, m = b.length; j < m; j++) {
            if (segsCross(a1, a2, b[j]!, b[(j + 1) % m]!)) return true;
        }
    }
    return false;
};

/**
 * Every ring of the design, with how deeply each is nested.
 *
 * Both open and closed subpaths become rings: a stroke drawn inside a shape is
 * still an area the design covers, and dropping it would engrave it away. It has
 * no width to invert, though, so the caller is told.
 */
const buildRings = (aSub: Subpath[]): { aRing: Ring[]; warnings: string[] } => {
    const aWarnings: string[] = [];

    const aAll = aSub
            .map(s => ({ pts: dedupe(s.points), open: !s.closed }))
            .filter(o => o.pts.length >= 3)
            .map(o => ({ ...o, box: subBounds([{ points: o.pts, closed: true }]), area: ringArea(o.pts) })),
        aRing: Ring[] = aAll
            .filter(o => o.area >= MIN_RING_AREA)
            // Largest first: only a bigger ring can contain a smaller one, so each
            // ring only has to be tested against the ones already seen.
            .sort((a, b) => b.area - a.area)
            .map(o => ({ ...o, depth: 0 }));

    if (!aRing.length) {
        throw new Error("This design has no filled shape big enough to invert.");
    }

    const iSpecks = aAll.length - aRing.length;
    if (iSpecks) {
        aWarnings.push(`${iSpecks} ${iSpecks === 1 ? "speck" : "specks"} smaller than 0.01 mm² were ignored — far below any laser spot.`);
    }
    if (aRing.some(r => r.open)) {
        aWarnings.push("Some paths are not closed; they were closed straight across. A stroke has no width to invert — give it a real outline in your design app if it should stand proud.");
    }

    // Nesting depth, and on the way the pairs worth checking for a real overlap:
    // boxes that meet without one holding the other.
    const aSuspect: [number, number][] = [];
    for (let i = 0; i < aRing.length; i++) {
        for (let j = 0; j < i; j++) {
            const ri = aRing[i]!, rj = aRing[j]!;
            if (boxInside(ri.box, rj.box)) {
                if (inRing(ri.pts[0]!, rj.pts)) ri.depth++;
            } else if (boxOverlaps(ri.box, rj.box)) {
                aSuspect.push([i, j]);
            }
        }
    }

    // Alternating fill is only the design's own meaning while its shapes do not
    // cross: where two filled shapes overlap, even-odd reads the overlap as a
    // hole — so it would come out engraved, cutting a gap through the middle of
    // what should be one solid piece. Worth saying out loud rather than shipping
    // a stamp with a crack in it.
    let budget = CROSS_BUDGET,
        bCross = false;
    for (const [i, j] of aSuspect) {
        const a = aRing[i]!.pts, b = aRing[j]!.pts;
        budget -= a.length * b.length;
        if (budget < 0) break;
        if (ringsCross(a, b)) { bCross = true; break; }
    }
    if (bCross) {
        aWarnings.push("Two shapes in this design overlap. Their overlap inverts to a hole, so it will be engraved away — merge those shapes into one (union) before inverting.");
    }

    return { aRing, warnings: aWarnings };
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const mirrorRing = (a: Point[], axis: MirrorAxis, cx: number, cy: number): Point[] =>
    axis === "none"
        ? a
        : a.map(p => (axis === "h" ? { x: 2 * cx - p.x, y: p.y } : { x: p.x, y: 2 * cy - p.y }));

const shiftRing = (a: Point[], dx: number, dy: number): Point[] =>
    a.map(p => ({ x: p.x - dx, y: p.y - dy }));

export const buildInvert = (doc: DesignDoc, o: InvertOptions): InvertResult => {
    const aSub = scaleSubpaths(doc.aSub, o.scale > 0 ? o.scale : 1),
        { aRing: aDesign, warnings } = buildRings(aSub),
        aWarnings = [...doc.warnings, ...warnings];

    // Mirroring about the design's own centre leaves the bounding box — and so
    // the plate — exactly where it was.
    const bDesign = ringBounds(aDesign.map(r => r.pts)),
        mcx = (bDesign.x0 + bDesign.x1) / 2,
        mcy = (bDesign.y0 + bDesign.y1) / 2,
        oFrame = buildFrame(bDesign, o),
        // The design's filled area by the same alternating rule the export uses:
        // a ring at even depth adds, a hole at odd depth takes away.
        fDesign = aDesign.reduce((s, r) => s + (r.depth % 2 ? -r.area : r.area), 0);

    // A rounded or elliptical plate can bite into the design's bounding box, so
    // whether the artwork actually fits has to be asked point by point.
    const iOutside = aDesign.reduce(
        (n, r) => n + (r.pts.some(p => !oFrame.holds(p)) ? 1 : 0), 0
    );
    if (iOutside) {
        aWarnings.push(`${iOutside} ${iOutside === 1 ? "shape reaches" : "shapes reach"} past the plate's edge and ${iOutside === 1 ? "is" : "are"} cut off by it — raise the margin, or lower the corner radius.`);
    }

    const bFrame = ringBounds([oFrame.ring]),
        width = bFrame.x1 - bFrame.x0,
        height = bFrame.y1 - bFrame.y0;
    if (!(width > 0) || !(height > 0)) {
        throw new Error("The plate has no area — this design is a single straight line, so give it a margin to sit in.");
    }

    const
        // Exported with the plate's own corner as the origin, so the file is
        // exactly as big as the piece.
        frame = shiftRing(oFrame.ring, bFrame.x0, bFrame.y0),
        aRing = aDesign.map(r =>
            shiftRing(mirrorRing(r.pts, o.mirror, mcx, mcy), bFrame.x0, bFrame.y0)
        ),
        fFrame = ringArea(frame),
        engraved = fFrame > 0 ? Math.max(0, Math.min(1, (fFrame - fDesign) / fFrame)) : 0;

    // Everything in one path, drawn even-odd: the plate is filled, each shape of
    // the design is a hole in it, and a counter inside a shape is filled again.
    const sInverted = ringPathData([frame, ...aRing]),
        sFrame = pathData(frame),
        sw = Math.max(0.05, width / 500);

    return {
        frame,
        aRing,
        width,
        height,
        shapes: aRing.length,
        points: frame.length + aRing.reduce((n, a) => n + a.length, 0),
        engraved,
        cut: o.cut,
        // The engraved area in its operation colour; the parts left standing show
        // the work area through the holes, which is what the material will look
        // like. The plate edge is outlined so it reads against a white ground.
        preview: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(width)} ${r3(height)}">`
            + `<path d="${sInverted}" fill="${ENGRAVE.css}" fill-rule="evenodd"/>`
            + `<path d="${sFrame}" fill="none" stroke="#0f172a" stroke-opacity="0.45" stroke-width="${r3(sw)}"/>`
            + (o.cut ? `<path d="${sFrame}" fill="none" stroke="${CUT.css}" stroke-width="${r3(sw * 1.8)}"/>` : "")
            + "</svg>",
        warnings: aWarnings
    };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const invertToSvg = (r: InvertResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + `<path d="${ringPathData([r.frame, ...r.aRing])}" fill="${ENGRAVE.css}" fill-rule="evenodd"/>`
    + (r.cut
        ? `<path d="${pathData(r.frame)}" fill="none" stroke="${CUT.css}" stroke-width="${EXPORT_STROKE}"/>`
        : "")
    + "</svg>";

/**
 * DXF cannot express a fill, so the alternation is left to the laser software:
 * every ring goes out as a closed LWPOLYLINE in the surface-engraving colour,
 * and filling nested closed contours alternately is what LightBurn, Falcon and
 * xTool all do by default. The plate's edge is repeated in cutting red when a
 * cut line was asked for.
 */
export const invertToDxf = (r: InvertResult): string => {
    const aEntity: DxfEntity[] = [r.frame, ...r.aRing].map(a => ({
        color: ENGRAVE.color,
        closed: true,
        points: a.map(p => ({ ...p }))
    }));
    if (r.cut) {
        aEntity.push({ color: CUT.color, closed: true, points: r.frame.map(p => ({ ...p })) });
    }
    // SVG y grows downward, DXF y grows upward: flip about the plate's height.
    aEntity.forEach(e => e.points.forEach(p => { p.y = r.height - p.y; }));
    return buildDxf(aEntity);
};

/**
 * Falcon Design Space keeps the operation per layer, and an .fds shape is a
 * QPainterPath — whose default fill rule is odd-even. So the whole inversion is
 * one surface-engraving shape holding the plate and every ring of the design,
 * and it arrives ready to run.
 */
export const invertToFds = (r: InvertResult): Promise<Blob> => {
    const toSub = (a: Point[]): Subpath => ({ points: a, closed: true }),
        aShape = [{ mode: 0, subpaths: [r.frame, ...r.aRing].map(toSub) }];
    if (r.cut) aShape.push({ mode: 2, subpaths: [toSub(r.frame)] });
    return buildFds(aShape);
};
