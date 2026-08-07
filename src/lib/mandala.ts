import { arcSegments, circleRing, pathData, r3 } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Operation, Point } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Mandalas and sunbursts.
//
// A decorative tool, which means the only thing that matters is whether it
// comes out looking deliberate — and the way to get that is fewer controls that
// each move the whole drawing, not a slider per ring.
//
// Everything is one family of shapes. A motif occupies an angular slot of
// 2π/symmetry, spans a band of radius, and its half-angle at each point is
//
//     a(t) = aMax · f(t),   t = 0 at the inner edge, 1 at the outer
//
// where f is the only thing that differs between a petal, a spoke and a
// scallop. That is worth the constraint: four motifs written four times would
// drift, and four motifs sharing a sampler stay a set.
//
// The one thing this tool has to be careful about is **cut** mandalas. A cut
// pattern is holes in a disc, and holes that meet each other separate the disc
// into pieces. Nothing on the canvas shows that — a mandala that will fall into
// forty petals looks exactly like one that will not. So the material left
// between motifs and between rings is computed from the parameters and reported
// in millimetres, and the tool complains long before it reaches zero.
// ---------------------------------------------------------------------------

const FILL = OPERATION_COLORS.FILL_VECTOR_ENGRAVING!;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

export const MANDALA_LIMITS = {
    minSize: 20,
    maxSize: 1000,
    minSymmetry: 3,
    maxSymmetry: 64,
    minRings: 1,
    maxRings: 10
} as const;

/**
 * What one repeat of a ring looks like.
 *
 * The set is not arbitrary. Every tutorial on drawing a mandala reaches for the
 * same handful — teardrops, pointed petals, dots, triangles, arcs, diamonds —
 * because they are the shapes that survive being repeated thirty times without
 * turning to mush, and `dots` is in there because a ring that is *not* a band
 * of motifs is what stops a mandala reading as a set of concentric fences.
 */
export type Motif = "petal" | "lotus" | "drop" | "spoke" | "scallop" | "diamond" | "dart" | "dots";

export type MandalaStyle = Motif | "mixed";

/** Burnt into the surface, or cut clean through. */
export type MandalaMode = "engrave" | "cut";

export interface MandalaOptions {
    /** outer diameter, mm */
    size: number;
    /** how many times each ring repeats round the circle */
    symmetry: number;
    rings: number;
    style: MandalaStyle;
    /**
     * Share of each motif's slot left as material, 0…0.8.
     *
     * This is the web between one motif and the next. On an engraved mandala it
     * is a look; on a cut one it is what holds the thing together.
     */
    gap: number;
    /** material between one ring and the next, mm */
    ringGap: number;
    /** plain disc in the middle, as a share of the radius */
    hub: number;
    /** a hole through the middle to hang it by, mm — 0 for none */
    hole: number;
    /** a thin circle between one ring and the next */
    ringLines: boolean;
    /**
     * Draw the motifs as outlines rather than solid areas.
     *
     * This is what a mandala actually *is*. Every one ever drawn is line work —
     * the shapes are outlined and only then, sometimes, filled in — and solid
     * blobs are the single thing that makes a generated one look generated.
     * Engraved as lines it is also a fraction of the burn.
     */
    outlined: boolean;
    /**
     * A smaller copy of each motif inside itself.
     *
     * The other hallmark: "layered smaller petals, offset". One echo turns a
     * shape into a motif, and it costs nothing but a second ring.
     */
    nested: boolean;
    mode: MandalaMode;
    /** cut the outer circle */
    outline: boolean;
    /** which mandala this is, when the style is mixed */
    seed: number;
}

export interface MandalaLayer {
    operation: Operation;
    rings: Point[][];
    filled: boolean;
}

export interface MandalaResult {
    preview: string;
    aLayer: MandalaLayer[];
    width: number;
    height: number;
    /**
     * Motifs, all rings together — shapes, not rings of geometry.
     *
     * A nested echo is part of its motif rather than another one, and a dot is
     * one motif. Counting rings instead would say a mandala had twice as many
     * motifs the moment the echo was switched on, which is not a thing anybody
     * means by the word.
     */
    motifs: number;
    /** the narrowest material left between two motifs, mm */
    web: number;
    /** the material between rings, mm */
    ringWeb: number;
    points: number;
    warnings: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 100) / 100} mm`;

const rng = (seed: number): (() => number) => {
    let a = (Math.floor(seed) || 1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * The half-angle profile of each motif, as a fraction of its widest.
 *
 * `t` runs 0 at the inner edge of the ring to 1 at the outer. Every one of them
 * is 0 at both ends, which is what closes the shape without a special case.
 */
const PROFILE: Record<Motif, (t: number) => number> = {
    // A lens: widest in the middle, pointed at both ends.
    petal: t => Math.sin(Math.PI * t),
    // The same, drawn out to a sharp point at each end. The classic lotus
    // petal, and the shape most people picture when they hear "mandala".
    lotus: t => Math.sin(Math.PI * t) ** 1.7,
    // Narrow at the hub and round at the rim, like a flame.
    drop: t => Math.sin(Math.PI * t) ** 0.6 * (0.35 + 0.65 * t),
    // Nearly parallel sides with rounded ends: a slot.
    spoke: t => Math.min(1, Math.sin(Math.PI * t) * 2.6),
    // Fat almost all the way, so the material between them is a thin rib.
    scallop: t => Math.sin(Math.PI * t) ** 0.4,
    // Straight sides to a point either side: a rhombus. The one angular shape
    // in the set, and the one that makes a ring read as geometry rather than
    // as flowers.
    diamond: t => 1 - Math.abs(2 * t - 1),
    // A triangle standing on the hub and widening to the rim.
    dart: t => t,
    // Not a band shape at all — see `dotRing`.
    dots: () => 0
};

/** The motifs that are a shape in a band, as against a ring of circles. */
const BANDS = (Object.keys(PROFILE) as Motif[]).filter(m => m !== "dots");

/**
 * A ring of small circles.
 *
 * Every mandala tutorial has one, and the reason is structural rather than
 * decorative: a run of bands all made of the same kind of shape reads as a set
 * of concentric fences. One ring of dots between them breaks the rhythm, and
 * suddenly the whole thing looks composed.
 */
const dotRing = (centre: Point, r0: number, r1: number, n: number, phase: number): Point[][] => {
    const rMid = (r0 + r1) / 2,
        // Big enough to read, small enough that they never touch: half the band
        // or half the gap between two of them, whichever is less.
        rDot = Math.min((r1 - r0) / 2, (Math.PI * rMid) / n * 0.62);
    return Array.from({ length: n }, (_, k) => {
        const a = phase + (2 * Math.PI * k) / n;
        return circleRing(centre.x + rMid * Math.cos(a), centre.y + rMid * Math.sin(a), Math.max(0.2, rDot));
    });
};

/** Points per motif along each of its two edges. */
const STEPS = 26;

/** One motif, as a closed ring in Cartesian coordinates about the centre. */
const motifRing = (
    centre: Point,
    r0: number,
    r1: number,
    angle: number,
    halfMax: number,
    profile: (t: number) => number
): Point[] => {
    const at = (t: number, side: number): Point => {
        const r = r0 + (r1 - r0) * t,
            a = angle + side * halfMax * profile(t);
        return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
    };
    const out: Point[] = [];
    for (let i = 0; i <= STEPS; i++) out.push(at(i / STEPS, +1));
    for (let i = STEPS; i >= 0; i--) out.push(at(i / STEPS, -1));
    return out;
};

export const buildMandala = (opt: MandalaOptions): MandalaResult => {
    const L = MANDALA_LIMITS,
        warnings: string[] = [],
        size = clamp(opt.size, L.minSize, L.maxSize),
        R = size / 2,
        n = Math.round(clamp(opt.symmetry, L.minSymmetry, L.maxSymmetry)),
        rings = Math.round(clamp(opt.rings, L.minRings, L.maxRings)),
        gap = clamp(opt.gap, 0.05, 0.8),
        ringGap = clamp(opt.ringGap, 0, R / 2),
        hub = clamp(opt.hub, 0, 0.8) * R,
        hole = clamp(opt.hole, 0, R),
        centre: Point = { x: R, y: R },
        next = rng(opt.seed);

    // The bands the rings occupy, inside out.
    const span = Math.max(0, R - hub - ringGap * rings),
        band = span / rings,
        aRing = Array.from({ length: rings }, (_, i) => ({
            r0: hub + ringGap * (i + 1) + band * i,
            r1: hub + ringGap * (i + 1) + band * (i + 1)
        }));

    // The widest a motif may be. Two limits, and the second one is what makes
    // this look like a mandala rather than a scatter of blobs: a motif is
    // allowed its whole slot less the web, *and* it is never wider than the
    // band it sits in is tall. Without that, twelve-fold symmetry on a shallow
    // ring gives shapes wider than they are long, and no amount of taste in the
    // profile can rescue those — they read as lumps at three sizes.
    // 0.42 is a *half*-width, so a motif is at most 0.84 of the band wide and
    // therefore always taller than it is wide. That is the proportion that
    // reads as a petal; anything squarer reads as a tile.
    const slotHalf = (Math.PI / n) * (1 - gap),
        aspect = 0.42;

    // Nesting is an engraved idea: a smaller hole inside a hole is a ring of
    // material that falls out on its own.
    const bNested = opt.nested && opt.mode !== "cut",
        aMotif: Point[][] = [],
        aMotifKind: Motif[] = [];
    let web = Infinity,
        nMotif = 0;

    for (const [i, r] of aRing.entries()) {
        // Mixed never puts two dot rings together and never opens on one: a
        // ring of dots is punctuation, and punctuation on its own is not a
        // sentence.
        const motif: Motif = opt.style === "mixed"
            ? (i > 0 && next() < 0.28 && aMotifKind[i - 1] !== "dots"
                ? "dots"
                : BANDS[Math.floor(next() * BANDS.length)]!)
            : opt.style;
        aMotifKind.push(motif);
        const profile = PROFILE[motif];

        // Every other ring is turned half a slot, so the pattern reads as a
        // weave rather than as spokes lining up all the way out.
        const phase = (i % 2) * (Math.PI / n);

        if (motif === "dots") {
            aMotif.push(...dotRing(centre, r.r0, r.r1, n, phase));
            nMotif += n;
            web = Math.min(web, ((2 * Math.PI * ((r.r0 + r.r1) / 2)) / n) * 0.24);
            continue;
        }

        // Where the motif is at its widest, and therefore where the material
        // between two of them is at its narrowest.
        let tFat = 0;
        for (let k = 0; k <= STEPS; k++) {
            if (profile(k / STEPS) > profile(tFat)) tFat = k / STEPS;
        }
        const rFat = r.r0 + (r.r1 - r.r0) * tFat,
            // The angle at which the motif would be exactly `aspect` of the
            // band wide, and the slot's own limit. Whichever is tighter wins.
            halfMax = Math.min(slotHalf, rFat > 0 ? (aspect * (r.r1 - r.r0)) / rFat : slotHalf),
            here = 2 * ((Math.PI / n) - halfMax * profile(tFat)) * rFat;
        web = Math.min(web, here);

        for (let k = 0; k < n; k++) {
            const a = phase + (2 * Math.PI * k) / n;
            aMotif.push(motifRing(centre, r.r0, r.r1, a, halfMax, profile));
            // The echo. Inset radially as well as narrowed, or it would touch
            // its parent at both ends.
            if (bNested) {
                const inset = (r.r1 - r.r0) * 0.22;
                aMotif.push(motifRing(centre, r.r0 + inset, r.r1 - inset, a, halfMax * 0.52, profile));
            }
        }
        nMotif += n;
    }

    if (!isFinite(web)) web = 0;

    // ── the middle and the edge ─────────────────────────────────────────
    //
    // A thin circle between the rings. Nothing structural — it is the single
    // cheapest thing that makes a set of repeated motifs read as one design
    // instead of three unrelated ones.
    const aRule: Point[][] = [];
    if (opt.ringLines && rings > 0) {
        for (const [i, r] of aRing.entries()) {
            if (i > 0) aRule.push(circleRing(centre.x, centre.y, r.r0 - ringGap / 2));
        }
        if (hub > 0) aRule.push(circleRing(centre.x, centre.y, hub + ringGap / 2));
    }

    const aHole: Point[][] = [];
    if (hole > 0) aHole.push(circleRing(centre.x, centre.y, hole / 2));

    const outline = opt.outline ? [circleRing(centre.x, centre.y, R)] : [];

    // ── sanity ──────────────────────────────────────────────────────────
    if (band <= 0) {
        warnings.push("The hub and the gaps between the rings take up the whole disc — there is no room left for a pattern.");
    }
    if (opt.mode === "cut") {
        if (web < 1) {
            warnings.push(
                `Only ${mm(web)} of material is left between one motif and the next. Cut, this comes off the bed in `
                + "pieces. Raise the web, or drop the symmetry."
            );
        } else if (web < 2) {
            warnings.push(`${mm(web)} between motifs is fragile in anything but plywood. Handle the piece by its rim.`);
        }
        if (ringGap < 1 && rings > 1) {
            warnings.push(
                `The rings are ${mm(ringGap)} apart, which is what holds one ring to the next. Under a millimetre `
                + "they tear."
            );
        }
        if (hole > 0 && hole / 2 > hub) {
            warnings.push("The hanging hole is bigger than the hub it is punched in, so it eats into the first ring.");
        }
    }
    if (n > 40 && opt.mode === "cut") {
        warnings.push(`${n}-fold symmetry means ${n * rings} openings, most of them narrow. Beautiful engraved; brittle cut.`);
    }

    // ── layers ──────────────────────────────────────────────────────────
    // A rule is a *line* and never a hole: cut, it would fall out as a ring of
    // its own and take the pattern with it. So even on a cut mandala the rules
    // are engraved.
    const aLayer: MandalaLayer[] = opt.mode === "cut"
        ? [
            { operation: CUT, rings: [...outline, ...aMotif, ...aHole], filled: false },
            ...(aRule.length ? [{ operation: MARK, rings: aRule, filled: false }] : [])
        ]
        : [
            ...(outline.length || aHole.length
                ? [{ operation: CUT, rings: [...outline, ...aHole], filled: false }]
                : []),
            opt.outlined
                ? { operation: MARK, rings: [...aMotif, ...aRule], filled: false }
                : { operation: FILL, rings: aMotif, filled: true },
            ...(!opt.outlined && aRule.length ? [{ operation: MARK, rings: aRule, filled: false }] : [])
        ];

    return {
        preview: svgOf(aLayer, size),
        aLayer,
        width: size,
        height: size,
        motifs: nMotif,
        web,
        ringWeb: ringGap,
        points: aLayer.reduce((a, l) => a + l.rings.reduce((m, r) => m + r.length, 0), 0),
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const svgOf = (aLayer: MandalaLayer[], size: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(size)}mm" height="${r3(size)}mm"`
    + ` viewBox="0 0 ${r3(size)} ${r3(size)}">`
    + aLayer.map(l => {
        const d = l.rings.map(a => pathData(a)).join(" ");
        return l.filled
            ? `<path d="${d}" fill="${l.operation.css}" fill-rule="evenodd"/>`
            : `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="${EXPORT_STROKE}"/>`;
    }).join("")
    + "</svg>";

export const mandalaToSvg = (r: MandalaResult): string => svgOf(r.aLayer, r.width);

export const mandalaToDxf = (r: MandalaResult): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.rings.map(a => ({
            color: l.operation.color,
            closed: true,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const mandalaToFds = (r: MandalaResult): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: l.filled ? 0 : 2,
        subpaths: l.rings.map(a => ({ points: a, closed: true }))
    })));

/** Exported for the tests: the arc a circle of this radius needs. */
export const segmentsFor = (radius: number): number => arcSegments(radius, Math.PI / 2);
