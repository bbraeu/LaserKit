import { pathData, r3, rectRing } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Point } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Living hinges: a flat sheet cut so that it bends.
//
// The trick is old and the geometry is simple — a field of slits, brick-offset
// so no cut ever runs clear across the panel — but the number everyone gets
// wrong is *why* it bends, and that decides every control here.
//
// A solid panel bent to a radius stretches its outer face. Plywood tears at
// something under two per cent strain, so 3 mm ply can be persuaded round about
// a 100 mm radius and no tighter. A lattice hinge does not stretch at all: the
// strips between the slits **twist** about their own long axis, and the bend is
// the sum of all those little twists. That is why the slits must run parallel
// to the axis you are bending around, why the *link* — the uncut material
// between two slits end to end — is the part that breaks, and why a hinge with
// twice as many rows is twice as bendy rather than twice as strong.
//
// It also gives one exact figure worth more than any rule of thumb:
//
//     twist per row = pitch / radius
//
// No material constant, no fudge: if the rows are 5 mm apart and you want a
// 40 mm radius, every row turns 5/40 of a radian — 7.2° — relative to the next.
// The tool reports that, and the shear strain it puts through the link, and
// then says plainly that the only real answer is a test strip. Everything past
// this point is geometry; the wood is your problem.
// ---------------------------------------------------------------------------

const CUT = OPERATION_COLORS.VECTOR_CUTTING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

/** What the inspector's sliders and this file's clamps agree on. */
export const HINGE_LIMITS = {
    minSize: 10,
    maxSize: 1200,
    minPitch: 1,
    maxPitch: 30,
    minLink: 0.5,
    maxLink: 30,
    minSlit: 3,
    maxSlit: 400,
    maxThickness: 25,
    maxKerf: 1,
    /** a slit shorter than this is a scorch mark, not a cut */
    minSegment: 1.5
} as const;

/** How the field of slits is drawn. */
export type HingePattern = "straight" | "wave" | "tee";

/** Which way the finished panel rolls up. */
export type BendAxis = "vertical" | "horizontal";

export interface HingeOptions {
    width: number;
    height: number;
    /**
     * The axis the panel rolls around.
     *
     * "vertical" makes a tube standing on its end: the slits run up and down,
     * and the panel curls left to right. This is the one that matters — a hinge
     * cut the wrong way round does not bend at all, it just falls apart.
     */
    bendAxis: BendAxis;
    pattern: HingePattern;

    /** distance between one row of slits and the next, mm */
    pitch: number;
    /** uncut material between two slits end to end — the part that twists */
    link: number;
    /** how long each slit wants to be; adjusted so the rows fit the panel */
    slit: number;
    /** uncut border along the two edges the slits run towards */
    inset: number;
    /** uncut material at each end of the bend, so the hinge is a band */
    flat: number;

    /** material thickness, mm — only used to work out the strain */
    thickness: number;
    /** beam width, mm — it comes off both ends of every link */
    kerf: number;
    /** the radius you mean to bend it to, mm — a readout, not a constraint */
    radius: number;

    /** cut the panel's own outline as well as the slits */
    outline: boolean;
    /** amplitude of a wave slit as a fraction of the pitch */
    amplitude: number;
}

export interface HingeResult {
    preview: string;
    rings: Point[][];
    /** the panel outline, when it is being cut */
    outline: Point[][];
    width: number;
    height: number;

    /** rows of slits across the bend */
    rows: number;
    /** the pitch they actually came out at, mm */
    pitch: number;
    /** the slit length they actually came out at, mm */
    slit: number;
    /** what is left of the link once the beam has been through both ends */
    effectiveLink: number;
    /** how far the head travels cutting, mm */
    cutLength: number;
    /** how much of the panel is burnt away, as a fraction */
    removed: number;

    /** how far one row turns relative to the next, in radians */
    twistPerRow: number;
    /** peak shear strain in a link at that twist, as a fraction */
    strain: number;
    /** the tightest radius the rule of thumb below will allow, mm */
    minRadius: number;

    warnings: string[];
}

// ---------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 10) / 10} mm`;

/**
 * Shear strain a link will take before it gives up, as a fraction.
 *
 * This is the one number here that is not geometry, and it is a rule of thumb
 * rather than a property of anything. Plywood in rolling shear across the
 * plies, acrylic, MDF and a hardwood veneer all behave differently, and the
 * same sheet behaves differently damp. It sets where the tool starts warning,
 * nothing more — the honest test is a 40 mm strip bent round the thing you are
 * building.
 */
const STRAIN_LIMIT = 0.035;

/** Points per wave slit. It carries one full period, so this is plenty. */
const WAVE_STEPS = 24;

// ---------------------------------------------------------------------------
// The field of slits
//
// Everything is generated with the slits running along +y and the bend running
// along +x, because that is the only case worth reasoning about. A panel that
// rolls the other way is the same field transposed, done once at the end.
// ---------------------------------------------------------------------------

interface Field {
    /** one entry per row of slits, each a list of [start, end] along y */
    aColumn: { x: number; aSpan: [number, number][] }[];
    pitch: number;
    slit: number;
}

/**
 * Where every slit falls.
 *
 * Both counts are rounded to fit rather than left to fall off the end: the
 * pattern is symmetric in the panel, and a row of stubs at one edge is both
 * ugly and the place it will tear. The *link* is held exactly — it is the part
 * that carries the load, so it is the number worth being able to set — and the
 * slit length gives way to make the arithmetic come out.
 */
const layField = (o: HingeOptions, bandLength: number, runLength: number): Field => {
    const L = HINGE_LIMITS,
        link = clamp(o.link, L.minLink, L.maxLink),
        // Rows across the bend. Two is the fewest that is a hinge rather than
        // a pair of scores.
        rows = Math.max(2, Math.round(bandLength / clamp(o.pitch, L.minPitch, L.maxPitch))),
        pitch = bandLength / rows,
        // Slits along the run. A column of m slits and m−1 links spans
        // m·(s+l) − l, so the period follows from the length it has to fill.
        period = clamp(o.slit, L.minSlit, L.maxSlit) + link,
        m = Math.max(1, Math.round((runLength + link) / period)),
        Q = (runLength + link) / m,
        slit = Q - link;

    const aColumn = Array.from({ length: rows }, (_, i) => {
        // Every other row is shifted half a period, so no cut ever lines up
        // with the one beside it and the panel stays in one piece.
        const phase = i % 2 === 0 ? 0 : Q / 2,
            aSpan: [number, number][] = [];
        for (let k = -1; k <= m; k++) {
            const s = k * Q + phase,
                a = Math.max(0, s),
                b = Math.min(runLength, s + slit);
            if (b - a >= HINGE_LIMITS.minSegment) aSpan.push([a, b]);
        }
        return { x: (i + 0.5) * pitch, aSpan };
    });

    return { aColumn, pitch, slit };
};

/** One slit, in the field's own coordinates. */
const slitPath = (x: number, y0: number, y1: number, o: HingeOptions, pitch: number): Point[] => {
    if (o.pattern === "wave") {
        // A wave takes the same bend over a longer cut, so the material at the
        // end of it is not asked to turn a corner — which is where a straight
        // slit splits first.
        const amp = clamp(o.amplitude, 0, 0.45) * pitch,
            len = y1 - y0;
        // One period per slit, so it starts and ends on the column's own line
        // and the brick offset still means what it means.
        return Array.from({ length: WAVE_STEPS + 1 }, (_, i) => {
            const t = i / WAVE_STEPS;
            return { x: x + amp * Math.sin(t * Math.PI * 2), y: y0 + t * len };
        });
    }
    return [{ x, y: y0 }, { x, y: y1 }];
};

/**
 * The bar across the end of a slit.
 *
 * A straight slit ends in a point, and a point is where all the stress in the
 * link goes: that is the crack every failed living hinge starts from. Turning
 * the end into a T spreads it along a line instead. It costs a little
 * stiffness and buys a hinge that survives being opened twice.
 */
const teeBar = (x: number, y: number, half: number): Point[] => [{ x: x - half, y }, { x: x + half, y }];

/**
 * Just the slits, for something else to put a corner in.
 *
 * The box generator's rounded corners are this and nothing else: a strip of
 * hinge dropped into a wall that wraps. It gets the field rather than a copy of
 * the code, so a fix to the brick bond or to how the rows are rounded reaches
 * both tools — and so the two never quietly disagree about what a link is.
 *
 * `bend` runs across the slits (the direction the panel curls) and `run` along
 * them. The rings come back in a `bend` × `run` box with the slits parallel to
 * the second axis; whoever asked for them decides where that box lands.
 */
export const hingeField = (o: {
    bend: number;
    run: number;
    pattern: HingePattern;
    pitch: number;
    link: number;
    slit: number;
    kerf: number;
    amplitude?: number;
}): { rings: Point[][]; rows: number; pitch: number; slit: number } => {
    const opt: HingeOptions = {
        width: Math.max(HINGE_LIMITS.minSize, o.bend),
        height: Math.max(HINGE_LIMITS.minSize, o.run),
        bendAxis: "vertical",
        pattern: o.pattern,
        pitch: o.pitch,
        link: o.link,
        slit: o.slit,
        inset: 0,
        flat: 0,
        thickness: 3,
        kerf: o.kerf,
        radius: 40,
        outline: false,
        amplitude: o.amplitude ?? 0.25
    };
    const field = layField(opt, Math.max(1, o.bend), Math.max(1, o.run)),
        rings: Point[][] = [],
        half = Math.min(field.pitch * 0.35, Math.max(0.5, field.pitch / 2 - o.kerf));

    for (const col of field.aColumn) {
        for (const [a, b] of col.aSpan) {
            rings.push(slitPath(col.x, a, b, opt, field.pitch));
            if (o.pattern === "tee") {
                if (a > 0.01) rings.push(teeBar(col.x, a, half));
                if (b < o.run - 0.01) rings.push(teeBar(col.x, b, half));
            }
        }
    }
    return { rings, rows: field.aColumn.length, pitch: field.pitch, slit: field.slit };
};

// ---------------------------------------------------------------------------

export const buildHinge = (o: HingeOptions): HingeResult => {
    const L = HINGE_LIMITS,
        warnings: string[] = [],
        W = clamp(o.width, L.minSize, L.maxSize),
        H = clamp(o.height, L.minSize, L.maxSize),
        thickness = clamp(o.thickness, 0.1, L.maxThickness),
        kerf = clamp(o.kerf, 0, L.maxKerf),
        radius = Math.max(1, o.radius);

    // The bend runs along the panel's width when it rolls about a vertical
    // axis, and along its height when it rolls about a horizontal one. Working
    // in the first case only and transposing at the end halves the code and,
    // more to the point, halves the number of places the axes can be swapped
    // by mistake.
    const bendSpan = o.bendAxis === "vertical" ? W : H,
        runSpan = o.bendAxis === "vertical" ? H : W,
        flat = clamp(o.flat, 0, Math.max(0, bendSpan / 2 - L.minPitch)),
        inset = clamp(o.inset, 0, Math.max(0, runSpan / 2 - L.minSegment)),
        bandLength = bendSpan - 2 * flat,
        runLength = runSpan - 2 * inset;

    const field = layField(o, bandLength, runLength),
        half = Math.min(field.pitch * 0.35, Math.max(0.5, field.pitch / 2 - kerf));

    const aLocal: Point[][] = [];
    for (const col of field.aColumn) {
        for (const [a, b] of col.aSpan) {
            aLocal.push(slitPath(col.x, a, b, o, field.pitch));
            if (o.pattern === "tee") {
                // Only where the slit ends inside the panel: a bar on a slit
                // that runs off the edge would cut the corner clean off.
                if (a > 0.01) aLocal.push(teeBar(col.x, a, half));
                if (b < runLength - 0.01) aLocal.push(teeBar(col.x, b, half));
            }
        }
    }

    // Field space → panel space: shift past the flat end and the border, then
    // swap the axes if the panel rolls the other way.
    const place = (p: Point): Point => o.bendAxis === "vertical"
        ? { x: p.x + flat, y: p.y + inset }
        : { x: p.y + inset, y: p.x + flat };
    const rings = aLocal.map(a => a.map(place));

    const outline = o.outline ? [rectRing({ x0: 0, y0: 0, x1: W, y1: H }, 0)] : [];

    // --- what it will actually do -----------------------------------------
    //
    // Exact, and the reason the pitch is worth caring about: bending an arc of
    // radius R over a row spacing p turns each row p/R relative to the last.
    const twistPerRow = field.pitch / radius,
        // A thin rectangular strip twisted through α over its own length l
        // shears most at its surface, by about α·t/(2·l). The link is what is
        // twisting, so its length is the l here.
        effectiveLink = Math.max(0.01, clamp(o.link, L.minLink, L.maxLink) - kerf),
        strain = (twistPerRow * thickness) / (2 * effectiveLink),
        minRadius = (field.pitch * thickness) / (2 * effectiveLink * STRAIN_LIMIT);

    const cutLength = rings.reduce((n, a) => {
        let d = 0;
        for (let i = 1; i < a.length; i++) d += Math.hypot(a[i]!.x - a[i - 1]!.x, a[i]!.y - a[i - 1]!.y);
        return n + d;
    }, 0);

    // --- sanity ------------------------------------------------------------
    if (effectiveLink < kerf) {
        warnings.push(
            `A ${mm(o.link)} link with a ${mm(kerf)} kerf leaves ${mm(effectiveLink)} of material — the slits meet and `
            + "the panel falls into strips. Widen the link."
        );
    } else if (effectiveLink < thickness * 0.8) {
        warnings.push(
            `The links come out ${mm(effectiveLink)} once the beam has been through both ends, against ${mm(thickness)} `
            + "of thickness. Shorter than it is thick, a link snaps instead of twisting."
        );
    }
    if (strain > STRAIN_LIMIT) {
        warnings.push(
            `Bent to ${mm(radius)} this puts about ${(strain * 100).toFixed(1)} % shear through every link, which is past `
            + `what most sheet takes. The rows want to be about ${mm((field.pitch * radius) / minRadius)} apart for that `
            + `radius, or this pattern will manage ${mm(minRadius)}. Either way: cut a strip and bend it before you cut the panel.`
        );
    }
    if (field.slit < L.minSlit) {
        warnings.push(`The slits came out ${mm(field.slit)} long — that is a perforation, not a hinge. Make them longer or the panel taller.`);
    }
    if (field.aColumn.length < 4) {
        warnings.push(`${field.aColumn.length} rows will not curve — they fold at each row instead. A hinge wants a dozen or more across the bend.`);
    }
    if (inset > 0) {
        warnings.push(
            `A ${mm(inset)} uncut border runs along both edges of the hinge, and it is stiffer than everything between `
            + "it. Set the border to 0 unless something has to be screwed to it."
        );
    }
    if (!rings.length) {
        warnings.push("Nothing is cut: the slits do not fit in the panel at these sizes.");
    }

    // --- the drawing -------------------------------------------------------
    const all = [...outline, ...rings],
        body = `<path d="${all.map(a => pathData(a, false)).join(" ")}" fill="none" stroke="${CUT.css}"`
            + ` stroke-width="${EXPORT_STROKE}" stroke-linecap="round"/>`;

    return {
        preview: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(W)}mm" height="${r3(H)}mm"`
            + ` viewBox="0 0 ${r3(W)} ${r3(H)}">${body}</svg>`,
        rings,
        outline,
        width: W,
        height: H,
        rows: field.aColumn.length,
        pitch: field.pitch,
        slit: field.slit,
        effectiveLink,
        cutLength,
        removed: (cutLength * kerf) / Math.max(1, W * H),
        twistPerRow,
        strain,
        minRadius,
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
//
// A slit is an open line, not a closed contour — there is no inside to it. The
// panel's own outline is the only closed ring here.
// ---------------------------------------------------------------------------

const paths = (r: HingeResult): { ring: Point[]; closed: boolean }[] => [
    ...r.outline.map(a => ({ ring: a, closed: true })),
    ...r.rings.map(a => ({ ring: a, closed: false }))
];

export const hingeToSvg = (r: HingeResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + paths(r).map(o => `<path d="${pathData(o.ring, o.closed)}" fill="none" stroke="${CUT.css}"`
        + ` stroke-width="${EXPORT_STROKE}"/>`).join("")
    + "</svg>";

export const hingeToDxf = (r: HingeResult): string => {
    const aEntity: DxfEntity[] = paths(r).map(o => ({
        color: CUT.color,
        closed: o.closed,
        // SVG y grows downward, DXF y grows upward.
        points: o.ring.map(p => ({ x: p.x, y: r.height - p.y }))
    }));
    return buildDxf(aEntity);
};

export const hingeToFds = (r: HingeResult): Promise<Blob> =>
    buildFds([{
        mode: 2,
        subpaths: paths(r).map(o => ({ points: o.ring, closed: o.closed }))
    }]);
