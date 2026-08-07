import {
    MIN_RING_AREA, boxInside, boxOverlaps, dedupe, ellipseRing, inRing, pathData, r3,
    readDesignFile, rectRing, ringArea, ringBounds, ringPathData, scaleSubpaths, shiftRing, subBounds
} from "./design";
import type { Box, DesignDoc } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
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

/** Above this many segment pairs the shapes-overlap check gives up (a warning only). */
const CROSS_BUDGET = 4e6;

/** Shape of the plate the design is subtracted from. */
export type FrameShape = "rect" | "ellipse" | "circle";

/** Mirroring: a stamp has to be engraved back-to-front to print the right way. */
export type MirrorAxis = "none" | "h" | "v";

export interface InvertOptions {
    frame: FrameShape;
    /**
     * The finished stamp's size in mm, or null to let the design decide it.
     *
     * Given one, the plate is exactly that big and the design is scaled to sit
     * inside it with the margin still around it — because "a 40 × 15 mm stamp"
     * is a thing you order, while "a design plus 3 mm" is not.
     */
    size: { w: number; h: number } | null;
    /** millimetres of plate around the design on every side */
    margin: number;
    /** corner radius in mm — rectangular plates only */
    radius: number;
    mirror: MirrorAxis;
    /**
     * Nudge the artwork inside the plate, in mm.
     *
     * The plate is built around the design's bounding box, which centres a
     * *box* — and a box is not what the eye centres on. A motif with a long
     * tail or an off-centre flourish reads as crooked at dead centre, so the
     * plate stays where it is and the artwork moves within it.
     */
    offset: { x: number; y: number };
    /** multiplier on the geometry, for an SVG whose physical size had to be guessed */
    scale: number;
    /** also emit the plate's edge as a cut line, to free the stamp from the sheet */
    cut: boolean;
}

export interface InvertResult {
    /** the plate's edge, origin at 0,0 — the outer ring of the inverted figure */
    frame: Point[];
    /** the same edge as parameters, so the stamp kit can regrow it at another size */
    spec: FrameSpec;
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

/**
 * The plate written out as the handful of numbers that define it, rather than as
 * the ring they were turned into. The stamp kit needs the very same plate a few
 * millimetres larger, and growing a rectangle or an ellipse by its parameters is
 * exact where offsetting its polygon would not be.
 */
export type FrameSpec =
    | { shape: "rect"; box: Box; radius: number }
    | { shape: "round"; cx: number; cy: number; rx: number; ry: number };

export const frameRing = (o: FrameSpec): Point[] =>
    o.shape === "rect" ? rectRing(o.box, o.radius) : ellipseRing(o.cx, o.cy, o.rx, o.ry);

/** Centre of the plate — where a handle belongs. */
export const frameCentre = (o: FrameSpec): Point =>
    o.shape === "rect"
        ? { x: (o.box.x0 + o.box.x1) / 2, y: (o.box.y0 + o.box.y1) / 2 }
        : { x: o.cx, y: o.cy };

const shiftFrame = (o: FrameSpec, dx: number, dy: number): FrameSpec =>
    o.shape === "rect"
        ? { ...o, box: { x0: o.box.x0 + dx, y0: o.box.y0 + dy, x1: o.box.x1 + dx, y1: o.box.y1 + dy } }
        : { ...o, cx: o.cx + dx, cy: o.cy + dy };

interface Frame {
    spec: FrameSpec;
    ring: Point[];
    /** is the point on or inside the plate? Closed form, so it is cheap per point. */
    holds: (p: Point) => boolean;
}

/**
 * How much the design has to grow or shrink to sit inside a plate of the asked-for
 * size with the margin still around it — the inverse of the plate constructions
 * below, so a size taken straight off the current plate comes back as exactly 1
 * and nothing moves when the field is first filled in.
 *
 * An axis the design has no extent on constrains nothing, and a plate with no
 * room left inside the margin is caught by the caller.
 */
const fitScale = (bDesign: Box, o: InvertOptions): number => {
    if (!o.size) return 1;
    const m = Math.max(0, o.margin),
        hw = (bDesign.x1 - bDesign.x0) / 2,
        hh = (bDesign.y1 - bDesign.y0) / 2,
        ax = o.size.w / 2,
        ay = o.size.h / 2;

    if (o.frame === "circle") {
        const d = Math.hypot(hw, hh);
        return d > 0 ? (Math.min(ax, ay) - m) / d : 1;
    }
    // The rectangle holds the box outright; the ellipse only passes through its
    // corners at √2 times its half-sides.
    const f = o.frame === "rect" ? 1 : Math.SQRT2,
        a = hw > 0 ? (ax - m) / (hw * f) : Infinity,
        b = hh > 0 ? (ay - m) / (hh * f) : Infinity,
        k = Math.min(a, b);
    return isFinite(k) ? k : 1;
};

/**
 * The plate around a design. A rectangle is the design's bounding box grown by
 * the margin; an ellipse has to circumscribe that box, so its semi-axes are the
 * box's half-sides times √2 — the smallest ellipse of the same proportions that
 * still contains every corner.
 *
 * With a size asked for, all of that is skipped: the plate is exactly that big,
 * centred on the design, which `fitScale` has already sized to fit.
 */
const buildFrame = (bDesign: Box, o: InvertOptions): Frame => {
    const m = Math.max(0, o.margin),
        cx = (bDesign.x0 + bDesign.x1) / 2,
        cy = (bDesign.y0 + bDesign.y1) / 2,
        hw = (bDesign.x1 - bDesign.x0) / 2,
        hh = (bDesign.y1 - bDesign.y0) / 2;

    if (o.frame === "rect") {
        const box: Box = o.size
            ? { x0: cx - o.size.w / 2, y0: cy - o.size.h / 2, x1: cx + o.size.w / 2, y1: cy + o.size.h / 2 }
            : { x0: bDesign.x0 - m, y0: bDesign.y0 - m, x1: bDesign.x1 + m, y1: bDesign.y1 + m },
            r = Math.max(0, Math.min(o.radius, Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2)),
            // Distance from the box's inner corner rectangle — zero inside it,
            // so the test collapses to the plain box when r is 0.
            ihw = (box.x1 - box.x0) / 2 - r,
            ihh = (box.y1 - box.y0) / 2 - r,
            fcx = (box.x0 + box.x1) / 2,
            fcy = (box.y0 + box.y1) / 2;
        return {
            // The clamped radius, not the one asked for: the kit has to grow the
            // plate that was actually drawn.
            spec: { shape: "rect", box, radius: r },
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
    // which is the box's half-diagonal. A circle asked for a size takes the
    // smaller of the two, so it stays a circle whatever was typed.
    const rCircle = o.size ? Math.min(o.size.w, o.size.h) / 2 : Math.hypot(hw, hh) + m,
        ax = o.frame === "circle" ? rCircle : o.size ? o.size.w / 2 : hw * Math.SQRT2 + m,
        ay = o.frame === "circle" ? rCircle : o.size ? o.size.h / 2 : hh * Math.SQRT2 + m;

    return {
        spec: { shape: "round", cx, cy, rx: ax, ry: ay },
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

export const buildInvert = (doc: DesignDoc, o: InvertOptions): InvertResult => {
    const aSub = scaleSubpaths(doc.aSub, o.scale > 0 ? o.scale : 1),
        { aRing: aDesign, warnings } = buildRings(aSub),
        aWarnings = [...doc.warnings, ...warnings];

    // A stamp asked for a size resizes the artwork, not the plate: the rings are
    // scaled about their own centre, which is where the plate is then built. Done
    // here rather than through `scale` because the fit is measured on the rings
    // the plate is drawn around, not on every stray subpath in the file.
    const bNatural = ringBounds(aDesign.map(r => r.pts)),
        k = fitScale(bNatural, o);
    if (!(k > 0)) {
        throw new Error("This stamp size leaves no room inside the margin — make it larger, or lower the margin.");
    }
    if (k !== 1) {
        const ccx = (bNatural.x0 + bNatural.x1) / 2,
            ccy = (bNatural.y0 + bNatural.y1) / 2;
        for (const r of aDesign) {
            r.pts = r.pts.map(p => ({ x: ccx + (p.x - ccx) * k, y: ccy + (p.y - ccy) * k }));
            r.area *= k * k;
        }
    }

    // Mirroring about the design's own centre leaves the bounding box — and so
    // the plate — exactly where it was.
    const bDesign = k === 1 ? bNatural : ringBounds(aDesign.map(r => r.pts)),
        mcx = (bDesign.x0 + bDesign.x1) / 2,
        mcy = (bDesign.y0 + bDesign.y1) / 2,
        oFrame = buildFrame(bDesign, o),
        // The design's filled area by the same alternating rule the export uses:
        // a ring at even depth adds, a hole at odd depth takes away.
        fDesign = aDesign.reduce((s, r) => s + (r.depth % 2 ? -r.area : r.area), 0);

    // Where each ring really ends up: mirrored about the design's own centre,
    // then nudged. Worked out once, because both the fits-inside check and the
    // output need the same answer.
    const dx = o.offset?.x ?? 0,
        dy = o.offset?.y ?? 0,
        aPlaced = aDesign.map(r =>
            mirrorRing(r.pts, o.mirror, mcx, mcy).map(p => ({ x: p.x + dx, y: p.y + dy })));

    // A rounded or elliptical plate can bite into the design's bounding box, so
    // whether the artwork actually fits has to be asked point by point.
    const iOutside = aPlaced.reduce(
        (n, a) => n + (a.some(p => !oFrame.holds(p)) ? 1 : 0), 0
    );
    if (iOutside) {
        aWarnings.push(`${iOutside} ${iOutside === 1 ? "shape reaches" : "shapes reach"} past the plate's edge and ${iOutside === 1 ? "is" : "are"} cut off by it — raise the margin, lower the corner radius${dx || dy ? ", or move the artwork back" : ""}.`);
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
        frame = shiftRing(oFrame.ring, -bFrame.x0, -bFrame.y0),
        spec = shiftFrame(oFrame.spec, -bFrame.x0, -bFrame.y0),
        aRing = aPlaced.map(a => shiftRing(a, -bFrame.x0, -bFrame.y0)),
        fFrame = ringArea(frame),
        engraved = fFrame > 0 ? Math.max(0, Math.min(1, (fFrame - fDesign) / fFrame)) : 0;

    // Everything in one path, drawn even-odd: the plate is filled, each shape of
    // the design is a hole in it, and a counter inside a shape is filled again.
    const sInverted = ringPathData([frame, ...aRing]),
        sFrame = pathData(frame),
        sw = Math.max(0.05, width / 500);

    return {
        frame,
        spec,
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
