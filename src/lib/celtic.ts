import { regionOf, ringsOf, signedArea, subtract, union } from "./boolean";
import type { Region } from "./boolean";
import { boxOverlaps, circleRing, pathData, r3, rectRing } from "./design";
import type { Box } from "./design";
import { OPERATION_COLORS } from "./dxf";
import type { Operation, Point } from "./dxf";

// ---------------------------------------------------------------------------
// The Celtic tree of life.
//
// A tree whose roots and whose branches both run into a plaited ring, cut as
// one closed piece. It is the design that most reliably comes off the bed in
// bits, because it is normally drawn as *lines that cross*, and a line crossing
// another line is, to a laser, a pair of cuts through both of them.
//
// The first version of this file answered that by handing the tool centrelines
// and letting it paint the lot onto a canvas and trace the result once. That
// worked, and it cost the one thing a cut file exists for: exactness. A traced
// edge is a staircase at whatever resolution the canvas was — an eighth of a
// millimetre here — every curve came back with a few hundred points, and the
// whole design went through a raster round trip on its way to a vector file.
//
// It now does the booleans properly: every limb, leaf, strand and tab becomes a
// polygon and the lot is merged with a real union (see boolean.ts). What comes
// out is `Region[]` — an outline and the holes in it, which is exactly one
// closed cut per contour and no seam anywhere two shapes happened to touch.
//
// Five things in here are not decoration, and are worth reading before changing
// any of it.
//
//   • **The braid is a plan, not a weave.** Celtic knotwork is strands passing
//     over and under each other, and a cut piece is flat: there is no over. So
//     what is drawn is the braid's *plan* — three sinusoidal bands round the
//     annulus, unioned, so every crossing is a join rather than a pair of cuts.
//     The whitespace between the strands is what gets cut away, and the braid
//     gap is that whitespace in millimetres.
//
//   • **The two thin rims are structural, not trim.** The braid on its own is a
//     scalloped band whose gaps open both inwards and outwards, so they are
//     notches rather than holes and the outside edge of the piece is a row of
//     bumps. A thin rim at each edge of the band closes every gap into a real
//     hole and gives the disc a round edge — and the inner one is what the
//     branches and the roots actually land on, so it is also the thing that
//     makes the tree one piece with the frame instead of a tree-shaped
//     drop-out.
//
//   • **Every root reaches the ring, on purpose.** A crown twig may droop and
//     end in mid-air, because that is what makes a canopy read as grown rather
//     than as a diagram. A root may not: roots are the anchor, and one that
//     stops short is a hairline of material holding the bottom of the disc.
//     Each primary in the crown also carries one chain that is forced out to
//     the rim, so the join is spread all the way round rather than left to the
//     dice.
//
//   • **A leaf that would be swallowed is engraved instead of cut.** This is
//     the one rule here that is about drawing rather than about strength, and
//     it is the difference between a canopy and a blob. Merged into the union,
//     a leaf lying across a branch or across another leaf loses its own
//     outline: the file has a lump where the drawing had two leaves. So every
//     candidate is measured against what is already on the sheet, and one that
//     has lost too much of itself is moved to the engraved layer — you still
//     see it, it is still exactly where it was, and there is no second cut line
//     running through the twig it hangs off.
//
//   • **There is a floor under the leaf size.** A tree with a hundred leaves
//     looks wonderful on screen and comes out of a 3 mm laser as a hundred
//     identical scorch marks, because each leaf is smaller than the kerf plus
//     the char around it. The floor is 4 mm, it is enforced rather than
//     suggested, and the leaf that was asked for smaller is grown and said so.
// ---------------------------------------------------------------------------

const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/**
 * The hairline a cut file wants, in mm.
 *
 * A cut path has no width — the beam decides that — so the stroke written into
 * the file is only there to make the path visible to whatever opens it. A tenth
 * of a millimetre is what LightBurn and the rest read as "this is a line, not a
 * drawn edge", and it is about the width the beam itself is, which is the only
 * honest answer.
 */
const EXPORT_STROKE = 0.1;

/**
 * ... and the width the stage needs, which is not the same number.
 *
 * A 150 mm disc fits a 700 px stage at about four and a half pixels per
 * millimetre, where the hairline is half a pixel and the whole tree becomes a
 * grey suggestion of itself. The preview is a picture and the export is a cut
 * file, and this is the one place they are allowed to differ.
 */
export const PREVIEW_STROKE = 0.3;

export const CELTIC_LIMITS = {
    minSize: 40,
    maxSize: 600,
    minDepth: 2,
    maxDepth: 6,
    minDensity: 2,
    /**
     * The most primaries that may leave the trunk.
     *
     * Ten, and the ceiling is measured rather than picked. Every primary forks
     * in two at every level, so the number of twigs that have to land on the
     * same ring is `density × 2^(depth−1)`: at ten and four levels that is
     * eighty tips on a rim four hundred millimetres round, which is dense and
     * still legible. Past that they are closer together than the twigs are
     * wide and the canopy closes into a solid band — the drawing stops changing
     * and only the cut time goes up.
     */
    maxDensity: 10,
    minKnot: 3,
    maxKnot: 40,
    maxLeaves: 400,
    /**
     * The smallest a leaf may be, along its long axis, in mm.
     *
     * Not a matter of taste. Under about 4 mm a cut leaf is a hole the size of
     * the beam plus its own char, so it stops being a leaf and becomes a dot —
     * and forty of them turn the canopy into a grey smudge. Asked for anything
     * smaller, the tool grows the leaf and says so.
     */
    minLeaf: 4,
    /**
     * How many strands are plaited round the ring.
     *
     * Three, and it is not a knob. Two strands crossing is a twist rather than
     * a plait — it reads as a rope, and everybody draws it by accident — and
     * four in a band anybody would cut leaves each strand thinner than the beam
     * plus the gap either side of it. Three is the smallest number that reads
     * as knotwork and the largest that survives a 10 mm band.
     */
    strands: 3
} as const;

/**
 * How near two leaves may be, as a fraction of the leaf size.
 *
 * Leaves hang off twigs and twigs arrive in bunches, so drawing every candidate
 * puts three leaves in the same square centimetre and leaves the next twig bare
 * — which is what "clumped" means, and why asking for fewer does not fix it. A
 * candidate closer than this to one already placed is dropped and the next
 * candidate is tried in its place, so the count asked for is still the count
 * drawn wherever there is room for it.
 */
const LEAF_SPACING = 1.2;

/**
 * How much of itself a leaf has to keep to be worth cutting.
 *
 * Below this it has been swallowed by a branch, by the frame or by the leaf
 * next to it, and cutting it would add a closed path that contributes nothing
 * to the outline of the piece while its cut line runs straight through the twig
 * it hangs off. Three quarters is where that sits in practice: the sliver a
 * leaf always loses where its own stalk meets its own twig is a few per cent,
 * and a twig crossing a leaf takes a third of it.
 */
const LEAF_KEEP = 0.75;

export interface CelticOptions {
    /** outer diameter, mm */
    size: number;
    /** how wide the plaited ring is, mm */
    ringWidth: number;
    /** how many loops the braid makes round the circle */
    knotDensity: number;
    /** whitespace between one strand and the next, mm — this is the cut */
    braidGap: number;
    /** the trunk's width at the foot, mm */
    trunk: number;
    /** how far the trunk leans and curves on its way up, 0…1 */
    sway: number;
    /** the width a primary leaves the trunk at, mm — independent of the trunk */
    branch: number;
    /** how many times a limb splits before it stops */
    depth: number;
    /** how many primaries leave the trunk */
    density: number;
    /** how far a limb wanders off straight, 0…1 */
    variance: number;
    /** leaves on the outer twigs */
    leaves: boolean;
    /** the long axis of one leaf, mm */
    leafSize: number;
    /** how many to hang */
    leafCount: number;
    /** two feet, and the tabs on the disc that drop into them */
    base: boolean;
    /** the sheet everything is cut from, mm */
    thickness: number;
    kerf: number;
    /** which tree this is */
    seed: number;
}

/**
 * A centreline with a width at each end: what a limb is before it is a polygon.
 *
 * Kept in the result even though the union has already been taken, because it
 * is the only form in which a test can ask "did that branch stay inside the
 * disc" — once everything is merged, a twig poking through the rim is
 * indistinguishable from the rim.
 */
export interface Stroke {
    points: Point[];
    /** width where it leaves its parent, mm */
    w0: number;
    /** width at the tip, mm */
    w1: number;
    /**
     * How the width gets from one to the other.
     *
     * 1 is a straight taper, which is what a branch does. The trunk uses a
     * higher number so that it keeps its buttress at the foot and is already
     * slim halfway up — a trunk that tapers linearly is a cone, and a cone is
     * not a tree.
     */
    ease: number;
}

/** A leaf, as the pointed oval it is drawn as. */
export interface Leaf {
    x: number;
    y: number;
    /** along its long axis, radians */
    angle: number;
    length: number;
    width: number;
}

export interface CelticResult {
    /** the outer diameter, once it has been clamped to something cuttable */
    size: number;
    /**
     * The whole drawing top to bottom, mm.
     *
     * The same as the diameter until the base is switched on, at which point
     * the tabs hang below the circle and the piece is taller than it is wide.
     * The export has to be that tall or the tabs come out clipped.
     */
    height: number;
    /** the plaited band, and what it is made of */
    ring: {
        inner: number;
        outer: number;
        /** the thin closing band at each edge, mm */
        rim: number;
        /** one strand across, mm */
        strand: number;
        /** loops round the circle, after clamping */
        lobes: number;
    };
    /** the whole cut piece, merged: an outline and the holes in it */
    aCut: Region[];
    /** a plain disc the same size with the same tabs, to stand behind it */
    aBacking: Region[];
    /** the centrelines, kept so containment can be measured after the fact */
    aStroke: Stroke[];
    /** the leaves that are cut, because enough of each one survives the union */
    aLeaf: Leaf[];
    /** the leaves that are engraved instead, because they would be swallowed */
    aLeafMark: Leaf[];
    /** the tabs under the disc that drop into the feet */
    aTab: Point[][];
    /** the feet, laid out side by side on their own little sheet */
    feet: { rings: Point[][]; width: number; height: number } | null;
    /** the leaf size actually used, which is never below the floor */
    leafSize: number;
    branchCount: number;
    /** leaves cut */
    leafCount: number;
    /** leaves engraved */
    markCount: number;
    /**
     * The narrowest fork in the drawing, mm — the first thing to snap.
     *
     * Measured where a limb leaves its parent rather than at its tip: every
     * limb tapers, and the last stretch of a twig carries nothing.
     */
    thinnest: number;
    /** closed contours in the cut layer: the edge of the piece and its holes */
    pieces: number;
    holes: number;
    /**
     * Whether the union came back as a single region.
     *
     * The one thing about this design that cannot be seen on the canvas. Two
     * regions means something — a twig, a root, the whole tree — is a separate
     * piece of material, and it falls out of the frame on the bed while the
     * screen shows a perfectly good tree in a ring.
     */
    bJoined: boolean;
    /** how long the booleans took, ms — the tool's only handle on its own cost */
    unionMs: number;
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

/** The shortest signed way round from one angle to another, in (−π, π]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Where a limb ends up, and which way it was going when it got there. */
const tipOf = (a: Point[]): { p: Point; angle: number } => {
    const p = a[a.length - 1]!,
        q = a[Math.max(0, a.length - 2)]!;
    return { p, angle: Math.atan2(p.y - q.y, p.x - q.x) };
};

// ---------------------------------------------------------------------------
// Centrelines, as polygons
//
// The kit's general answer to "the outline of a thick wandering line" is
// stroke.ts: one quadrilateral per segment plus a disc at every joint, unioned.
// It is the robust answer — no mitre to get wrong, correct however hard the
// line turns — and it is the wrong one here, for a reason that only shows up
// once the whole drawing is built from it. This design is a hundred and twenty
// limbs and three strands, which is about two thousand throwaway polygons and
// twenty thousand points; merging them cost 440 ms of an 810 ms build, measured,
// and a build that slow makes every slider in the tool feel broken.
//
// So the limbs and the strands are offset directly instead: one closed outline
// each, sampled from the same points, with a half-disc drawn into each end so
// the round cap survives. That is only correct while the line does not turn
// sharply over one sample — which every curve in this file guarantees, because
// they are all sampled Béziers and sinusoids with the sampling chosen against
// their own curvature. It is the same trade `ribbon` in shapes.ts makes, and
// for the same reason.
// ---------------------------------------------------------------------------

/** Points round a circle, at a sampling the caller controls. */
const ringAt = (centre: Point, r: number, segs: number): Point[] =>
    Array.from({ length: segs }, (_, i) => {
        const a = (2 * Math.PI * i) / segs;
        return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
    });

/**
 * The two sides of a centreline, offset by half its width at each point.
 *
 * The normal is averaged across the two neighbouring segments, which narrows
 * the band very slightly on the inside of a bend — by the cosine of half the
 * turn, so a thousandth at the sampling used here and invisible at any of them.
 */
const sidesOf = (aPt: Point[], halfAt: (i: number) => number, bClosed: boolean): { a: Point[]; b: Point[] } => {
    const n = aPt.length,
        a: Point[] = [],
        b: Point[] = [];
    for (let i = 0; i < n; i++) {
        const before = aPt[bClosed ? (i - 1 + n) % n : Math.max(0, i - 1)]!,
            after = aPt[bClosed ? (i + 1) % n : Math.min(n - 1, i + 1)]!,
            dx = after.x - before.x,
            dy = after.y - before.y,
            len = Math.hypot(dx, dy) || 1,
            h = halfAt(i),
            nx = (-dy / len) * h,
            ny = (dx / len) * h,
            p = aPt[i]!;
        a.push({ x: p.x + nx, y: p.y + ny });
        b.push({ x: p.x - nx, y: p.y - ny });
    }
    return { a, b };
};

/**
 * Half a circle from one side of a line across to the other: a round cap.
 *
 * Flat caps would do everywhere except at a fork, and a fork is where they show
 * — parent and child leave at different headings, so two flat caps at the same
 * point leave a wedge-shaped nick in the outline of the join. A cap is eight
 * points and there are two per limb, which is a great deal cheaper than the
 * joint discs it replaces.
 */
const capOf = (p: Point, tx: number, ty: number, h: number, from: number, segs = 8): Point[] =>
    Array.from({ length: segs - 1 }, (_, i) => {
        const phi = from + (Math.PI * (i + 1)) / segs;
        return {
            x: p.x + h * (Math.cos(phi) * -ty + Math.sin(phi) * tx),
            y: p.y + h * (Math.cos(phi) * tx + Math.sin(phi) * ty)
        };
    });

/** The unit direction at one end of a polyline, pointing out of it. */
const endDir = (a: Point, b: Point): { tx: number; ty: number } => {
    const dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy) || 1;
    return { tx: dx / len, ty: dy / len };
};

/** An open centreline with a width as one closed outline, round at both ends. */
const ribbonOf = (aPt: Point[], widthAt: (t: number) => number): Region => {
    const n = aPt.length;
    if (n < 2) return { rings: [] };
    const half = (i: number): number => Math.max(1e-3, widthAt(i / (n - 1)) / 2),
        { a, b } = sidesOf(aPt, half, false),
        tail = endDir(aPt[n - 2]!, aPt[n - 1]!),
        head = endDir(aPt[1]!, aPt[0]!);
    return {
        rings: [[
            ...a,
            ...capOf(aPt[n - 1]!, tail.tx, tail.ty, half(n - 1), 0),
            ...b.slice().reverse(),
            ...capOf(aPt[0]!, head.tx, head.ty, half(0), 0)
        ]]
    };
};

/** A band chopped into one quad per sample — see `Obstacle`. */
const quadsBetween = (a: Point[], b: Point[]): Region[] => {
    const n = Math.min(a.length, b.length),
        out: Region[] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        out.push({ rings: [[a[i]!, a[j]!, b[j]!, b[i]!]] });
    }
    return out;
};

/** The width of a stroke a fraction `t` along it. */
const widthOf = (s: Stroke) => (t: number): number => s.w1 + (s.w0 - s.w1) * (1 - t) ** s.ease;

/**
 * A limb as a cubic Bézier, sampled.
 *
 * The brief for this tool asks for Bézier branches; the kit works in sampled
 * polylines, and those are the same thing as long as the sampling is fine
 * enough that no cut shows the facets — which is what every other curve in the
 * kit already does, see `ribbon` in shapes.ts and `arcSegments` in design.ts.
 *
 * A limb is given as where it starts, which way it leaves, how far it travels
 * and how far it turns, never as four control points: control points are not
 * something a growth rule can reason about. The handles are what turn a
 * circular arc into something that flows — equal handles a third of the length
 * *is* the arc, and lengthening one at the other's expense slides the bend
 * along the limb, which is what a real branch does and what a constant-curvature
 * arc cannot do at any setting.
 */
const limb = (from: Point, angle: number, length: number, curl: number, lead: number, segs = 12): Point[] => {
    const half = curl / 2,
        end = angle + curl,
        // An arc of length L bending through θ spans L·sin(θ/2)/(θ/2) end to
        // end, so this is the limb's reach rather than its length.
        chord = length * (Math.abs(half) < 1e-4 ? 1 : Math.sin(half) / half),
        p3: Point = { x: from.x + chord * Math.cos(angle + half), y: from.y + chord * Math.sin(angle + half) },
        h0 = length * (0.20 + 0.26 * lead),
        h1 = length * (0.46 - 0.26 * lead),
        c1: Point = { x: from.x + h0 * Math.cos(angle), y: from.y + h0 * Math.sin(angle) },
        c2: Point = { x: p3.x - h1 * Math.cos(end), y: p3.y - h1 * Math.sin(end) },
        out: Point[] = [];

    for (let i = 0; i <= segs; i++) {
        const t = i / segs,
            u = 1 - t,
            a = u * u * u,
            b = 3 * u * u * t,
            c = 3 * u * t * t,
            d = t * t * t;
        out.push({
            x: a * from.x + b * c1.x + c * c2.x + d * p3.x,
            y: a * from.y + b * c1.y + c * c2.y + d * p3.y
        });
    }
    return out;
};

/**
 * How far a limb may run from `from`, heading `angle`, before it meets the
 * reach circle.
 *
 * The chain of limbs off one fork adds up to exactly the budget it was given,
 * so the budget *is* the distance the outermost tip travels. Handing every fork
 * the same number therefore only works if every fork is in the middle of the
 * disc, and none of them is: the crown starts above the centre and the roots
 * below it, and a limb leaving either one sideways has half a disc more room
 * than a limb leaving it outwards. Given one number for all of them, the
 * sideways limbs come up short and the outward ones walk out through the rim —
 * which is a tree wider than the disc it is supposed to be inside.
 *
 * So the room is measured per limb, as the chord from where it stands to where
 * its own heading crosses the reach circle.
 */
const roomFor = (from: Point, angle: number, centre: Point, reach: number): number => {
    const vx = from.x - centre.x,
        vy = from.y - centre.y,
        dot = vx * Math.cos(angle) + vy * Math.sin(angle),
        disc = dot * dot + reach * reach - (vx * vx + vy * vy);
    return disc <= 0 ? 0 : Math.max(0, Math.sqrt(disc) - dot);
};

// ---------------------------------------------------------------------------
// Measuring one shape against the ones already on the sheet
//
// Used for exactly one decision — whether a leaf is cut or engraved — but it is
// the decision that costs the most, so it is worth being careful about. Asking
// the boolean layer "does this leaf overlap the drawing" naively means handing
// it the whole merged frame, ten thousand points of it, once per leaf. Asking
// "does this leaf overlap any of these thirty small polygons that are anywhere
// near it" gets the same answer for a fraction of the work — so the frame is
// kept in its unmerged form for this one purpose, every candidate obstacle
// carries the box it lives in, and the ones nowhere near are dropped before the
// sweep line ever sees them.
// ---------------------------------------------------------------------------

interface Obstacle {
    region: Region;
    box: Box;
}

const boxOf = (a: Point[]): Box => {
    let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
    for (const p of a) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
};

/** Only the outline is measured: a hole is inside it by definition. */
const obstacleOf = (r: Region): Obstacle => ({ region: r, box: boxOf(r.rings[0] ?? []) });

/** An outline's area, less the holes in it. */
const areaOf = (a: Region[]): number =>
    a.reduce(
        (s, o) => s + o.rings.reduce((t, ring, i) => t + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0),
        0
    );

/**
 * The smallest hole worth cutting, in mm².
 *
 * A union of several hundred overlapping shapes leaves slivers. Where two
 * strands touch almost tangentially, or a leaf's tip grazes the twig it hangs
 * off, the sweep line is quite right to report a hole — and the hole is two
 * tenths of a millimetre across. The beam is one tenth. What that cuts is not
 * an opening, it is a scorch dot with a whole closed path of head travel spent
 * on getting to it, and on a plait with the gap closed up there are seventy of
 * them.
 *
 * A quarter of a square millimetre is about half a millimetre across, and it is
 * an area rather than a width so that a long thin sliver goes as well as a
 * round speck.
 */
const MIN_HOLE = 0.25;

/** Holes and specks too small to burn, taken out. */
const pruned = (a: Region[]): Region[] =>
    a.map(o => ({ rings: o.rings.filter((ring, i) => i === 0 || Math.abs(signedArea(ring)) >= MIN_HOLE) }))
        .filter(o => o.rings.length > 0 && Math.abs(signedArea(o.rings[0]!)) >= MIN_HOLE);

/** What fraction of a shape is left once everything near it has been taken out. */
const survivalOf = (ring: Point[], aNear: Obstacle[]): number => {
    const box = boxOf(ring),
        aHit = aNear.filter(o => boxOverlaps(box, o.box)).map(o => o.region);
    if (aHit.length === 0) return 1;
    const whole = areaOf([regionOf(ring)]);
    return whole <= 1e-9 ? 0 : areaOf(subtract([regionOf(ring)], aHit)) / whole;
};

// ---------------------------------------------------------------------------
// The frame
//
// Three strands sweeping in and out across the band, a third of a wavelength
// apart, plus a thin rim closing each edge. Every crossing is a union, so the
// braid comes out as one piece of material with a lens-shaped hole between
// every pair of strands — which is the plan of a plait, and the only thing a
// flat cut can say about one.
// ---------------------------------------------------------------------------

/** How finely the two rims are drawn: fine enough that no cut shows the facets. */
const RIM_SEGS = 180;

interface Braid {
    /** one region per strand, plus the two rims: what goes into the union */
    aPart: Region[];
    /**
     * The same geometry chopped small.
     *
     * A whole strand spans the disc, so its box tells a leaf nothing; the quads
     * it is made of are a millimetre or two across and can be dismissed by
     * their boxes in a few nanoseconds. Built here rather than rebuilt later
     * because the offsets they come from have already been worked out.
     */
    aRaw: Region[];
    /** one strand across, mm */
    strand: number;
    /** the closing band at each edge, mm */
    rim: number;
    /** the loop count actually used */
    lobes: number;
}

const buildBraid = (centre: Point, inner: number, outer: number, knot: number, gap: number): Braid => {
    const L = CELTIC_LIMITS,
        band = outer - inner,
        rMid = (inner + outer) / 2,
        /**
         * The rim is a fraction of the band rather than a fixed width, because
         * a fixed one is either a wire on a 30 mm band or the whole of a 3 mm
         * one. It is floored so that it never disappears — a rim thinner than
         * the beam is not a rim — and capped at a third of the band so there is
         * still something left for the braid to be drawn in.
         */
        rim = clamp(band * 0.12, 0.6, band * 0.34),
        /**
         * One strand across.
         *
         * The band divided by the strand count is the pitch, and the gap is
         * taken out of it: that is what makes the gap control read as "how much
         * whitespace", which is what somebody setting it is actually thinking
         * about. Floored well below anything cuttable rather than at a sane
         * width, because the warning downstream is a better answer than
         * silently ignoring the number that was typed in.
         */
        strand = Math.max(0.3, band / L.strands - gap),
        /**
         * How many loops the braid may make before it stops being a braid.
         *
         * A strand sweeps the full width of the band twice per loop, so past
         * some density the sweep is steeper than the strand is wide,
         * consecutive passes merge, and the whitespace is squeezed out of it.
         * Half a wavelength has to be worth a couple of strand widths for there
         * to be a hole between one pass and the next, and that is a property of
         * the circumference rather than of the number somebody typed.
         */
        room = Math.max(L.minKnot, Math.floor((Math.PI * rMid) / Math.max(0.6, strand * 2.2))),
        lobes = Math.min(Math.round(clamp(knot, L.minKnot, L.maxKnot)), room),
        // The crest of a strand touches the outer edge of the band and its
        // trough touches the inner one, so the braid fills the ring exactly —
        // and since an offset moves a point by at most half a width, nothing
        // the frame is made of can reach past the outer circle.
        amp = (band - strand) / 2,
        // Sixteen samples per loop keeps the chord sag well under a tenth of a
        // millimetre at any band width anybody cuts, and the floor stops a
        // three-loop braid from being a triangle.
        segs = Math.max(160, lobes * 16),
        aPart: Region[] = [],
        aRaw: Region[] = [];

    for (let k = 0; k < L.strands; k++) {
        const phase = (2 * Math.PI * k) / L.strands,
            aPt: Point[] = [];
        for (let i = 0; i < segs; i++) {
            const a = (2 * Math.PI * i) / segs,
                r = rMid + amp * Math.sin(lobes * a + phase);
            aPt.push({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
        }
        const { a, b } = sidesOf(aPt, () => strand / 2, true);
        aPart.push(
            Math.abs(signedArea(a)) >= Math.abs(signedArea(b))
                ? { rings: [a, b.slice().reverse()] }
                : { rings: [b, a.slice().reverse()] }
        );
        aRaw.push(...quadsBetween(a, b));
    }

    // The rims are built by taking one disc out of another rather than by
    // laying two rings side by side, so that the hole is exactly concentric
    // rather than nearly — the same reason the annulus in shapes.ts is written
    // as a subtraction.
    for (const [r0, r1] of [[outer - rim, outer], [inner, inner + rim]] as const) {
        const a = ringAt(centre, r1, RIM_SEGS),
            b = ringAt(centre, r0, RIM_SEGS);
        aPart.push(...subtract([regionOf(a)], [regionOf(b)]));
        aRaw.push(...quadsBetween(a, b));
    }

    return { aPart, aRaw, strand, rim, lobes };
};

// ---------------------------------------------------------------------------
// Something to stand it on
//
// A disc this size does not stand up, so it gets two tabs underneath and two
// feet with slots in them. The tabs go into the same union as everything else,
// so they are part of the disc's own outline rather than another piece to glue
// on — and the slot is the tab plus the kerf, because a slot cut to the nominal
// thickness is a slot the tab does not go into.
// ---------------------------------------------------------------------------

/** Where the two tabs sit under the disc, and how big they are. */
const tabPlan = (R: number, thickness: number): { spread: number; width: number; stand: number } => ({
    // Far enough apart to stop it rocking, close enough that both are still
    // under the ring rather than out in the air.
    spread: R * 0.52,
    width: Math.max(8, R * 0.22),
    /**
     * How far the tab hangs below the *lowest point of the disc* — not below
     * where it leaves the rim, which is where it started life and is why it did
     * not work. A tab at 0.52 R across starts a good deal above the bottom of
     * the circle, so a tab measured from there is shorter than the rim it has
     * to clear: the disc lands on its own edge and the slots never see it. This
     * is the part that sticks out past the bottom of the circle, so it is the
     * part that goes through the foot, and it is the sheet plus enough to stand
     * proud on the far side.
     */
    stand: Math.max(6, thickness * 2.2)
});

/**
 * The feet.
 *
 * Two plates, each with a slot the disc drops into. They are laid out side by
 * side on their own sheet so the extra file is one thing to cut rather than two
 * to arrange.
 */
const buildFeet = (
    R: number,
    thickness: number,
    kerf: number
): { rings: Point[][]; width: number; height: number } => {
    const plan = tabPlan(R, thickness),
        // Long enough across the disc that it cannot tip forwards, which is the
        // direction it wants to go.
        len = Math.max(40, R * 0.75),
        depth = Math.max(18, R * 0.30),
        // The slot takes the sheet plus what the beam took away from the tab.
        slotW = thickness + kerf,
        slotL = plan.width + kerf,
        gap = 6,
        rings: Point[][] = [];

    for (let i = 0; i < 2; i++) {
        const x0 = i * (len + gap);
        rings.push(rectRing({ x0, y0: 0, x1: x0 + len, y1: depth }, Math.min(4, depth / 3)));
        // The slot runs across the foot, centred, so the disc stands square.
        const cx = x0 + len / 2,
            cy = depth / 2;
        rings.push(rectRing({
            x0: cx - slotL / 2,
            y0: cy - slotW / 2,
            x1: cx + slotL / 2,
            y1: cy + slotW / 2
        }, 0));
    }
    return { rings, width: 2 * len + gap, height: depth };
};

// ---------------------------------------------------------------------------

/** A place on a twig where a leaf could hang, before it is known how many will. */
interface Site {
    at: Point;
    /** the direction the twig was going, radians */
    along: number;
    /** how far off that a leaf may sit */
    spread: number;
    /** at the very end of a twig, rather than partway along one */
    bTip: boolean;
}

const now = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());

export const buildCelticTree = (opt: CelticOptions): CelticResult => {
    const L = CELTIC_LIMITS,
        warnings: string[] = [],
        size = clamp(opt.size, L.minSize, L.maxSize),
        R = size / 2,
        centre: Point = { x: R, y: R },
        density = Math.round(clamp(opt.density, L.minDensity, L.maxDensity)),
        depth = Math.round(clamp(opt.depth, L.minDepth, L.maxDepth)),
        variance = clamp(opt.variance, 0, 1),
        sway = clamp(opt.sway, 0, 1),
        next = rng(opt.seed);

    // ── the ring ────────────────────────────────────────────────────────
    const t0 = now(),
        band = clamp(opt.ringWidth, 2, R * 0.5),
        outer = R,
        inner = R - band,
        braid = buildBraid(centre, inner, outer, opt.knotDensity, Math.max(0, opt.braidGap)),
        ring = { inner, outer, rim: braid.rim, strand: braid.strand, lobes: braid.lobes },
        /**
         * How far out a limb may grow.
         *
         * Past the inner rim rather than up to it. A limb that stops *on* the
         * inner circle touches the frame at a tangent, and a tangent is not a
         * join once the beam has had its tenth of a millimetre either side —
         * what comes off the bed is a ring and a tree that fell out of it.
         * Halfway across the band is well past the rim at every band width, and
         * still short of the outer edge, so a twig cannot dent the rim of the
         * disc from the inside.
         */
        reach = inner + band * 0.5;

    // ── the trunk ───────────────────────────────────────────────────────
    //
    // It stands **on the ring**. The first version had it floating in the
    // middle of the disc with the roots hanging below it, and that is the one
    // thing everybody notices first: a tree grows out of the ground, and here
    // the ground is the bottom of the band. A trunk that starts halfway up
    // reads as a shrub in a hoop.
    const trunkW = clamp(opt.trunk, 1, R * 0.4),
        /**
         * What a primary leaves the trunk at.
         *
         * Its own control rather than a fraction of the trunk, and the two
         * really are independent: a heavy trunk carrying fine branches is an
         * oak, fine branches on a slim trunk is a birch, and deriving one from
         * the other made both of those the same drawing at different sizes. It
         * is still capped against the trunk, because a branch wider than the
         * thing it grows out of is not a tree, it is a mistake with a slider.
         */
        branchW = Math.min(clamp(opt.branch, 0.4, R * 0.3), trunkW * 1.6),
        forkY = centre.y - R * 0.18,
        // The foot is a shade over twice `trunkW` across with a round cap, so
        // its centreline has to stop a half-width short of the rim or the widest
        // stroke in the drawing puts a bulge on the outside edge of the disc.
        footY = Math.min(centre.y + reach, centre.y + R - trunkW * 1.25),
        // Where the roots leave it: low, but clear of the foot, so they spread
        // sideways along the bottom of the ring rather than out of its very end.
        rootY = centre.y + (footY - centre.y) * 0.45;

    const aStroke: Stroke[] = [],
        aSite: Site[] = [];
    let thinnest = trunkW * 0.72,
        branchCount = 1;

    /**
     * The trunk: wide and curved at the foot, slim by the first fork.
     *
     * The sway is a piece of a sine rather than a bend, and it is anchored at
     * the foot — subtracting the value at t = 0 keeps the trunk standing square
     * on the band however far it leans further up. A trunk that leans from its
     * own base looks like it is falling over, which is a different drawing.
     */
    aStroke.push({
        points: Array.from({ length: 21 }, (_, i) => {
            const t = i / 20;
            return {
                x: centre.x + sway * R * 0.11 * (Math.sin(2.2 * t + 0.6) - Math.sin(0.6)),
                y: footY + (forkY - footY) * t
            };
        }),
        w0: trunkW * 2.2,
        w1: trunkW * 0.72,
        // Fat only near the ground: the buttress is the bottom fifth of the
        // trunk and the rest of it is already a branch.
        ease: 2.4
    });

    // ── how big a leaf is ───────────────────────────────────────────────
    const leafSize = Math.max(L.minLeaf, clamp(opt.leafSize, 0, R));
    if (opt.leaves && opt.leafSize < L.minLeaf) {
        warnings.push(
            `Leaves under ${mm(L.minLeaf)} come off the bed as scorch marks rather than leaves, so they have been `
            + `grown to ${mm(leafSize)}. The beam and the char it leaves are each about a tenth of a millimetre `
            + "wide, and a leaf has to be a good deal bigger than the hole that makes it."
        );
    }

    /**
     * How far a limb bends over its own length.
     *
     * Not random. A limb bends towards the horizontal, always — which is what a
     * branch does under its own weight and what a root does looking for width,
     * and between them it is the single thing that makes the drawing read as a
     * tree rather than as a starburst. Growing every limb straight out from the
     * middle gives a wheel; curling them all the same way gives a pinwheel;
     * curling each one flat gives a canopy.
     *
     * Bending them *tangentially* instead — round the inside of the ring — was
     * tried and is worse, for a reason worth writing down: it fills the
     * shoulders of the disc beautifully and then lays every twig along the rim
     * rather than into it, so the tree ends up floating in its own hoop. What
     * comes off the bed then is a loose ring and a tree-shaped drop-out. The
     * shoulders are filled by staggering where the primaries leave the trunk
     * instead — see `fan`.
     */
    const curlFor = (angle: number): number => {
        const a = wrap(angle),
            // The nearer of the two horizontals.
            toward = Math.abs(a) < Math.PI / 2 ? 0 : Math.PI * Math.sign(a || 1);
        return wrap(toward - a) * (0.18 + 0.30 * variance) + (next() - 0.5) * 0.5 * variance;
    };

    /**
     * A limb cut off where it first crosses the reach circle.
     *
     * The belt to `roomFor`'s braces, and it is needed because `roomFor`
     * measures a straight chord while a limb bends as it grows: a twig that
     * droops towards the bottom of the disc is turning *into* the rim, so it
     * gets there sooner than its allowance said it would. Rather than trying to
     * predict that for every kind of bend, the limb is simply stopped at the
     * circle — which is also exactly what it should do, since the circle is
     * where the ring is.
     */
    const clipToReach = (aPt: Point[]): Point[] => {
        const out: Point[] = [aPt[0]!];
        for (let i = 1; i < aPt.length; i++) {
            const p = aPt[i]!,
                d = Math.hypot(p.x - centre.x, p.y - centre.y);
            if (d <= reach) {
                out.push(p);
                continue;
            }
            const q = out[out.length - 1]!,
                dq = Math.hypot(q.x - centre.x, q.y - centre.y),
                t = (reach - dq) / Math.max(1e-9, d - dq);
            out.push({ x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t });
            break;
        }
        return out.length >= 2 ? out : aPt.slice(0, 2);
    };

    /** Bend a limb round to face straight out, so it ends on the ring. */
    const outwardCurl = (from: Point, angle: number): number =>
        wrap(Math.atan2(from.y - centre.y, from.x - centre.x) - angle);

    /**
     * Bend a limb down.
     *
     * Not every twig should end pointing outwards. A real one droops at the tip
     * under the weight of its own leaves, and a crown where every last twig
     * aims neatly at the rim reads as a diagram of a tree — the tips are the
     * part of the drawing anybody actually looks at.
     */
    const droopCurl = (angle: number): number =>
        wrap(Math.PI / 2 - angle) * (0.30 + 0.50 * next());

    /**
     * Grow one limb, then the two that come off it.
     *
     * Two, always. `density` is how many primaries leave the trunk, not how
     * many ways every fork splits — with a three-way split four levels deep the
     * crown has eighty-one tips, they all have to land on the same ring, and
     * what arrives is a comb rather than a tree. Binary forking gives
     * `density × 2^(depth−1)` of them, which at the defaults is forty: enough
     * to fill a disc, few enough that you can see between them.
     *
     * `bMustReach` is the structural half of the brief. A crown twig may droop
     * and end in mid-air; the chain carrying this flag may not, so every
     * primary contributes at least one limb that lands in the band. Left to the
     * dice, a seed now and then grows a whole quadrant of drooping twigs and
     * the tree hangs off the frame by three joins instead of twenty.
     */
    const grow = (
        from: Point,
        angle: number,
        w0: number,
        level: number,
        budget: number,
        bLeafy: boolean,
        bMustReach: boolean
    ): void => {
        // Whichever is smaller: what is left of the chain's allowance, or the
        // room this limb actually has in front of it — see `roomFor`.
        // Re-measured at every fork, because a child heads somewhere its parent
        // was not.
        const span = Math.min(budget, roomFor(from, angle, centre, reach)),
            bLast = level >= depth,
            // Roots always reach. A twig that stops short is a twig; a root
            // that stops short is the bottom of the disc held on by nothing.
            bReach = bLast && (bMustReach || !bLeafy || next() < 0.5),
            curl = bLast
                ? (bReach ? outwardCurl(from, angle) : droopCurl(angle))
                : curlFor(angle),
            // A limb that turns as it grows covers less ground than its own
            // length, so a limb that has to *land* on the ring is given the
            // length that gets it there rather than the distance it has to
            // travel — see `limb`. Everything before the last takes an even
            // share of what is left, so the forks land at regular intervals
            // along the radius. Halving at every level is the obvious thing and
            // it is wrong: the first limb takes half the disc on its own, and
            // everything interesting then happens in a knot at the far end of
            // four long straight spokes.
            bend = Math.abs(curl) / 2,
            chord = bend < 1e-3 ? 1 : Math.sin(bend) / bend,
            len = bLast
                ? (bReach ? span / Math.max(0.5, chord) : span * (0.42 + 0.42 * next()))
                : span / (depth - level + 1),
            aPt = clipToReach(limb(from, angle, len, curl, next())),
            tip = tipOf(aPt),
            /**
             * The taper, give or take a seventh.
             *
             * Every limb at a level used to come out at exactly the same width,
             * and a tree whose every third-level twig measures the same is a
             * diagram of a tree — the same tell as a fork that is a perfect Y.
             * The variation is on the *taper* rather than on the starting
             * width, so that a limb still leaves its parent at exactly the
             * width its parent arrived at: varying both ends would put a
             * visible step at every fork, which is a worse fault than the one
             * being fixed.
             */
            w1 = w0 * 0.74 * (0.85 + 0.30 * next());

        aStroke.push({ points: aPt, w0, w1, ease: 1 });
        // The width a limb *leaves its parent* at, not the width it ends at.
        // Every limb tapers to a point and the last few millimetres of a twig
        // carry nothing — a leaf at most, and most of those are engraved. What
        // snaps is the narrowest cross-section with something hanging off it,
        // which is the fork.
        thinnest = Math.min(thinnest, w0);
        branchCount++;

        // Somewhere to hang a leaf: one at the very end of a twig and two along
        // its length, off alternating sides. Which of them actually get leaves
        // is decided once the whole tree is grown — see the leaf pass below —
        // because a twig has no idea how many leaves the tree is allowed, nor
        // what is already drawn next to it.
        if (bLeafy && level >= depth - 1) {
            aSite.push({ at: tip.p, along: tip.angle, spread: 0.7, bTip: true });
            for (let k = 0; k < 2; k++) {
                const i = Math.min(aPt.length - 1, Math.max(1, Math.round(aPt.length * (0.42 + 0.28 * k)))),
                    at = aPt[i]!,
                    was = aPt[i - 1]!;
                aSite.push({
                    at,
                    along: Math.atan2(at.y - was.y, at.x - was.x) + (k % 2 === 0 ? 1 : -1) * 1.1,
                    spread: 0.5,
                    bTip: false
                });
            }
        }
        if (bLast) return;

        // Wander, not symmetry. The two children used to leave at exactly ±half
        // the spread, and a tree where every fork is a perfect Y is a diagram
        // of a tree. Each side now gets its own share of the fan.
        const sweep = 0.55 + 0.5 * variance,
            aim = Math.atan2(tip.p.y - centre.y, tip.p.x - centre.x),
            aChild = [-1, 1].map(side => {
                const share = sweep * (0.35 + 0.65 * next()),
                    jitter = (next() - 0.5) * 0.55 * variance;
                return tip.angle + side * share + jitter;
            });
        // The flag goes to whichever child is aimed nearer to straight out, so
        // the guaranteed join ends up where the limb was heading anyway rather
        // than dragging a twig back across the canopy to get there.
        const bOut = Math.abs(wrap(aim - aChild[0]!)) <= Math.abs(wrap(aim - aChild[1]!));
        aChild.forEach((a, i) => {
            grow(tip.p, a, w1, level + 1, span - len, bLeafy, bMustReach && (i === 0) === bOut);
        });
    };

    /**
     * The primaries, fanned over an arc and staggered along the trunk.
     *
     * Two things are going on, and the second one is the interesting one.
     *
     * The `sweep` stops a little short of a half-turn. Fanning the full 180°
     * puts one primary at exactly horizontal on each side; those two and the
     * trunk are then collinear, and read as a single straight bar drawn across
     * the whole disc, which no amount of good twig work recovers from.
     *
     * That alone leaves the shoulders of the circle — the patches at nine and
     * three o'clock — with nothing in them, because a limb bends towards the
     * horizontal and then stays at the height it left the trunk at for ever.
     * The fix is not to bend the limbs harder but to move where they start: the
     * flatter a primary is aimed, the further down the trunk it leaves from.
     * Which is also simply what a tree does — branches do not all come off at
     * one point, and a drawing where they do looks like a hand of cards.
     */
    const fan = (
        from: Point,
        toward: Point,
        aim: number,
        sweep: number,
        count: number,
        width: number,
        level: number,
        budget: number,
        bLeafy: boolean
    ): void => {
        for (let i = 0; i < count; i++) {
            const t = count === 1 ? 0.5 : i / (count - 1),
                // 0 for the primary aimed straight along, 1 for the flattest.
                out = Math.abs(t - 0.5) * 2,
                at: Point = {
                    x: from.x + (toward.x - from.x) * out * 0.55,
                    y: from.y + (toward.y - from.y) * out * 0.55
                };
            grow(at, aim + (t - 0.5) * sweep + (next() - 0.5) * 0.2 * variance, width, level, budget, bLeafy, true);
        }
    };

    // The crown: `density` primaries aimed up and swept across the top. The
    // flattest of them leave the trunk part of the way back down towards the
    // roots, which is what puts something in the shoulders of the disc.
    fan(
        { x: centre.x, y: forkY },
        { x: centre.x, y: rootY },
        -Math.PI / 2,
        Math.PI * 0.88,
        density,
        branchW,
        1,
        reach * 1.05,
        true
    );

    // The roots. They leave the trunk low down and spread *sideways* along the
    // bottom of the ring rather than downwards — there is no downwards left,
    // because the trunk is already standing on the band. The sweep is wider
    // than a half-turn so the outermost pair start above the horizontal and
    // curl down into the rim, which is how the bottom corners get filled. They
    // are a little slimmer than the crown because they are shorter, and they
    // carry no leaves — a flag rather than a filter, because a root twig is
    // exactly as wide as a branch twig and telling them apart afterwards is
    // guesswork.
    fan(
        { x: centre.x, y: rootY },
        { x: centre.x, y: footY },
        Math.PI / 2,
        Math.PI * 1.10,
        density + 1,
        branchW * 0.8,
        2,
        (reach - (rootY - centre.y)) * 1.2,
        false
    );

    // ── the base ────────────────────────────────────────────────────────
    const aTab: Point[][] = [],
        plan = tabPlan(R, opt.thickness);
    let feet: CelticResult["feet"] = null;
    if (opt.base) {
        for (const s of [-1, 1]) {
            const cx = centre.x + s * plan.spread,
                // Started inside the ring so the tab merges with it rather than
                // touching it at a tangent, which would be a hairline joint.
                y0 = centre.y + Math.sqrt(Math.max(0, R * R - plan.spread * plan.spread)) - band * 0.4;
            aTab.push(rectRing({
                x0: cx - plan.width / 2,
                y0,
                x1: cx + plan.width / 2,
                // Down past the bottom of the circle, not down from where it
                // left the rim — see `stand`.
                y1: centre.y + R + plan.stand
            }, 0));
        }
        feet = buildFeet(R, opt.thickness, opt.kerf);
    }

    // ── the leaves ──────────────────────────────────────────────────────
    //
    // Everything about a leaf is decided here rather than while the tree grows,
    // because all three of the rules need to see the drawing as a whole: how
    // many there are to be, whether this one is on top of the last one, and
    // whether enough of it would survive the union to be worth cutting.
    //
    // Tips first and then the sites along the twigs — a tree with twelve leaves
    // wants them at the ends of twelve twigs, not clustered halfway along four
    // — and shuffled inside each group, or a low count would light up whichever
    // quadrant happened to be grown first.
    const aLimb = aStroke.map(s => ribbonOf(s.points, widthOf(s)));

    const shuffled = (a: Site[]): Site[] => {
        const out = [...a];
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(next() * (i + 1));
            [out[i], out[j]] = [out[j]!, out[i]!];
        }
        return out;
    };

    /**
     * One leaf, hung off a point on a twig and pointing away from it.
     *
     * Offset by half its own length, so the leaf's *stalk end* is on the twig
     * and the rest of it sticks out. Centred on the twig instead — which is
     * what it used to be — the whole leaf is swallowed by the branch when the
     * two are merged, and a canopy of forty of them shows up as a slightly
     * lumpy stick.
     */
    const leafOf = (s: Site): Leaf => {
        const a = s.along + (next() - 0.5) * s.spread,
            // Upwards only. Varying either way would put the smallest leaves
            // below the floor, which is the one thing the floor is for.
            len = leafSize * (1 + 0.5 * next());
        return {
            x: s.at.x + Math.cos(a) * len * 0.5,
            y: s.at.y + Math.sin(a) * len * 0.5,
            angle: a,
            length: len,
            width: len * 0.42
        };
    };

    const aLeaf: Leaf[] = [],
        aLeafMark: Leaf[] = [],
        aPlaced: Leaf[] = [],
        aObstacle: Obstacle[] = [...braid.aRaw, ...aLimb].map(obstacleOf),
        wanted = Math.round(clamp(opt.leafCount, 0, L.maxLeaves)),
        apart = leafSize * LEAF_SPACING;

    if (opt.leaves && wanted > 0) {
        const pool = [...shuffled(aSite.filter(o => o.bTip)), ...shuffled(aSite.filter(o => !o.bTip))];
        for (const s of pool) {
            if (aPlaced.length >= wanted) break;
            const o = leafOf(s);
            // A leaf that pokes out through the ring is worse than no leaf: it
            // turns the outside edge of the disc into a row of bumps. Into the
            // band is fine and is the point — that is a leaf that met the frame.
            if (Math.hypot(o.x - centre.x, o.y - centre.y) + o.length / 2 > outer) continue;
            // Too near one already drawn. Skipped rather than counted, so the
            // next candidate gets the place instead and the count asked for is
            // still the count drawn wherever there is room for it.
            if (aPlaced.some(q => Math.hypot(q.x - o.x, q.y - o.y) < apart)) continue;

            const shape = leafRing(o);
            if (survivalOf(shape, aObstacle) >= LEAF_KEEP) {
                aLeaf.push(o);
                // Only the cut ones become obstacles. An engraved leaf is a
                // line on the material rather than material, so it cannot
                // swallow the leaf after it — though it does still keep its
                // distance, which is why the spacing test is against everything
                // placed rather than everything cut.
                aObstacle.push(obstacleOf(regionOf(shape)));
            } else {
                aLeafMark.push(o);
            }
            aPlaced.push(o);
        }
        if (aPlaced.length < wanted) {
            warnings.push(
                `${wanted} leaves were asked for and ${aPlaced.length} were drawn: the outer twigs ran out of places `
                + `to hang one that is not within ${mm(apart)} of a leaf already there. Another level of depth, or a `
                + "few more primaries, makes room for the rest — stacking them any closer would only draw the same "
                + "leaf twice."
            );
        }
    }

    // ── the union ───────────────────────────────────────────────────────
    //
    // One sweep over a hundred and something outlines. There is no clip to the
    // disc afterwards and there does not need to be: a limb is stopped at the
    // reach circle, which is half a band inside the rim; the braid's crest
    // touches the outer circle exactly and an offset moves a point by at most
    // half a width; and a leaf that would cross the rim is dropped above. What
    // there is instead is a measurement — three lines and no booleans — because
    // a bulge on the outside edge of a disc is invisible on screen and obvious
    // on the bed, and a warning is a better answer than quietly shaving it off.
    const aPart: Region[] = [...braid.aPart, ...aLimb];
    for (const o of aLeaf) aPart.push(regionOf(leafRing(o)));
    for (const a of aTab) aPart.push(regionOf(a));

    const aCut = pruned(union(aPart)),
        aBacking = union([regionOf(circleRing(centre.x, centre.y, R)), ...aTab.map(regionOf)]),
        unionMs = now() - t0,
        holes = aCut.reduce((n, o) => n + Math.max(0, o.rings.length - 1), 0),
        bJoined = aCut.length === 1;

    // The measurement the clip used to be. The tabs are the one thing that is
    // *meant* to hang outside the circle, so they are taken out of it — by
    // their boxes, which is exact for a rectangle and costs nothing.
    const aTabBox = aTab.map(boxOf),
        bInTab = (p: Point): boolean =>
            aTabBox.some(b => p.x >= b.x0 - 0.01 && p.x <= b.x1 + 0.01 && p.y >= b.y0 - 0.01 && p.y <= b.y1 + 0.01);
    let far = 0;
    for (const o of aCut) {
        for (const a of o.rings) {
            for (const p of a) {
                const d = Math.hypot(p.x - centre.x, p.y - centre.y);
                if (d > far && !bInTab(p)) far = d;
            }
        }
    }

    // ── sanity ──────────────────────────────────────────────────────────
    if (far > R + 0.01) {
        warnings.push(
            `Something in this drawing reaches ${mm(far - R)} past the edge of the disc, which should not be possible `
            + "and means a limb or a strand has been let out of its bounds. The piece will cut with a bulge on its "
            + "rim — change the ring width or the diameter until this note goes away."
        );
    }
    if (!bJoined) {
        warnings.push(
            `This tree comes off the bed as ${aCut.length} pieces rather than one: something in the drawing does not `
            + "touch anything else. It is the one fault here that the canvas cannot show you — widen the branches, add "
            + "a level of depth, or widen the ring so they have more of it to land in."
        );
    }
    if (thinnest < 1) {
        warnings.push(
            `The outermost twigs are ${mm(thinnest)} across. Cut, they snap while you are lifting the piece off `
            + "the bed — raise the branch width, or take a level off the depth."
        );
    } else if (thinnest < 1.8) {
        warnings.push(`The outermost twigs are ${mm(thinnest)} across, which is delicate in anything but plywood.`);
    }
    if (braid.strand < 1) {
        warnings.push(
            `The braid gap has eaten the strands: they are ${mm(braid.strand)} across, which is a wire holding up the `
            + "whole edge of the piece. Close the gap, or widen the ring."
        );
    }
    if (braid.rim < 1) {
        warnings.push(
            `A ${mm(braid.rim)} rim is the entire outside edge of the disc and the entire thing the branches land on. `
            + "Widen the ring — everything else in the drawing hangs off those two hoops."
        );
    }
    if (braid.lobes < Math.round(clamp(opt.knotDensity, L.minKnot, L.maxKnot))) {
        warnings.push(
            `The knot has been held to ${braid.lobes} loops. Past that the strands sweep across the band faster than `
            + "they are wide, consecutive passes merge, and the whitespace that makes it read as a plait closes up "
            + "into a plain band. A wider gap or a narrower ring buys more loops."
        );
    }
    if (opt.base && opt.thickness < 2) {
        warnings.push(`A ${mm(opt.thickness)} sheet makes a tab that snaps in the slot the first time it is lifted.`);
    }
    if (branchCount > 400) {
        warnings.push(
            `${branchCount} branches is a lot of path for the head to follow, and at this size most of them lie on `
            + "top of each other. Fewer primaries, or fewer levels."
        );
    }

    return {
        size,
        height: opt.base ? centre.y + R + plan.stand : size,
        ring,
        aCut,
        aBacking,
        aStroke,
        aLeaf,
        aLeafMark,
        aTab,
        feet,
        leafSize,
        branchCount,
        leafCount: aLeaf.length,
        markCount: aLeafMark.length,
        thinnest,
        pieces: aCut.length + holes,
        holes,
        bJoined,
        unionMs,
        warnings
    };
};

/**
 * One leaf as the closed ring it is drawn as.
 *
 * A pointed oval rather than an ellipse. The difference sounds like nothing and
 * is not: an ellipse hung off a twig reads as a bead, and a shape that comes to
 * a point at both ends reads as a leaf even at four millimetres — which is the
 * size these actually get cut at. The exponent puts the widest part a little
 * back from the middle, which is the other half of it.
 */
export const leafRing = (o: Leaf): Point[] => {
    const N = 16,
        half = (t: number): number => Math.sin(Math.PI * t) ** 0.78 * (o.width / 2),
        along = (t: number): number => (t - 0.5) * o.length,
        out: Point[] = [];
    for (let i = 0; i <= N; i++) out.push({ x: along(i / N), y: half(i / N) });
    for (let i = N; i >= 0; i--) out.push({ x: along(i / N), y: -half(i / N) });

    const c = Math.cos(o.angle),
        s = Math.sin(o.angle);
    return out.map(p => ({ x: o.x + p.x * c - p.y * s, y: o.y + p.x * s + p.y * c }));
};

// ---------------------------------------------------------------------------
// Output
//
// One `<path>` per layer, holes included as further subpaths of the same path
// rather than as paths of their own. That is what makes a hole a hole: a
// separate outline is a separate cut, and a consumer that fills the file gets a
// solid disc with a tree drawn on it instead of openwork.
// ---------------------------------------------------------------------------

export interface CelticLayer {
    operation: Operation;
    rings: Point[][];
}

/** Closed rings in millimetres, by layer, and the sheet they are drawn on. */
export interface CelticSheet {
    aLayer: CelticLayer[];
    width: number;
    height: number;
}

/** The disc: the merged piece as one cut layer, the swallowed leaves as marks. */
export const celticSheet = (r: CelticResult): CelticSheet => ({
    aLayer: [
        { operation: CUT, rings: ringsOf(r.aCut) },
        ...(r.aLeafMark.length ? [{ operation: MARK, rings: r.aLeafMark.map(leafRing) }] : [])
    ],
    width: r.size,
    height: r.height
});

/** Anything that goes out as its own file: the feet, the backing disc. */
export const cutSheet = (rings: Point[][], width: number, height: number): CelticSheet => ({
    aLayer: [{ operation: CUT, rings }],
    width,
    height
});

/**
 * A sheet as SVG.
 *
 * `fill="none"` because it is a cut file and there is nothing to fill; the
 * even-odd rule is stated anyway, and is not redundant — the moment anybody
 * drops the file into an editor and gives it a fill to look at, that rule is
 * what decides whether the holes are holes. Nothing here relies on winding
 * order, which is the one thing a boolean library is entitled to change.
 */
export const celticToSvg = (s: CelticSheet, stroke = EXPORT_STROKE): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(s.width)}mm" height="${r3(s.height)}mm"`
    + ` viewBox="0 0 ${r3(s.width)} ${r3(s.height)}">`
    + s.aLayer.map(l =>
        `<path d="${l.rings.map(a => pathData(a)).join(" ")}" fill="none" fill-rule="evenodd"`
        + ` stroke="${l.operation.css}" stroke-width="${r3(stroke)}"/>`
    ).join("")
    + "</svg>";
