import { circleRing, rectRing } from "./design";
import type { Point } from "./dxf";

// ---------------------------------------------------------------------------
// The Celtic tree of life.
//
// A tree whose branches reach up into a ring and whose roots reach down into
// the same ring, so the whole thing is one closed piece. It is the most common
// thing anybody cuts on a hobby laser after a name keychain, and it is also the
// design that most reliably comes off the bed in pieces — because it is drawn
// as *lines that cross*, and a line that crosses another line is, to a laser, a
// pair of cuts through both of them.
//
// So nothing in this file draws an outline. It produces **centrelines with
// widths** — the trunk, every branch, every root — plus leaves and a ring, and
// hands them to the tool, which paints the lot onto a canvas and traces the
// result once. What comes back is the silhouette of the union: branch meets
// trunk with no seam, leaf overlaps leaf with no seam, and the only closed
// curves in the export are the real edge of the real piece and the holes
// between the branches. That is the same trick the curved text uses, and it is
// the only honest answer to "these two shapes overlap".
//
// The other thing this file is careful about is leaf size. A tree with a
// hundred leaves looks wonderful on screen and comes out of a 3 mm laser as a
// hundred identical scorch marks, because each leaf is smaller than the kerf
// plus the char. There is a floor, it is enforced rather than suggested, and
// the count comes down to meet it.
// ---------------------------------------------------------------------------

export const CELTIC_LIMITS = {
    minSize: 40,
    maxSize: 600,
    minBranches: 2,
    maxBranches: 5,
    minDepth: 2,
    maxDepth: 6,
    /**
     * The smallest a leaf may be, along its long axis, in mm.
     *
     * Not a matter of taste. Under about 4 mm a cut leaf is a hole the size of
     * the beam plus its own char, so it stops being a leaf and becomes a dot —
     * and forty of them turn the canopy into a grey smudge. Asked for anything
     * smaller, the tool grows the leaf and says so.
     */
    minLeaf: 4
} as const;

export type BorderStyle = "none" | "plain" | "braid" | "rope" | "knot";

export interface CelticOptions {
    /** outer diameter, mm */
    size: number;
    /** how many ways each branch splits */
    branches: number;
    /** how many times it splits before it stops */
    depth: number;
    /** how far the branches wander off straight, 0…1 */
    twist: number;
    /** the trunk's width, mm — everything else is a fraction of it */
    trunk: number;
    /** leaves along the outer twigs */
    leaves: boolean;
    /** the long axis of one leaf, mm */
    leafSize: number;
    /** roots below, mirroring the branches above */
    roots: boolean;
    border: BorderStyle;
    /** how wide the ring is, mm */
    borderWidth: number;
    /** two feet, and the tabs on the disc that drop into them */
    base: boolean;
    /** the sheet everything is cut from, mm */
    thickness: number;
    kerf: number;
    /** which tree this is */
    seed: number;
}

/** A centreline with a width: what a branch actually is before it is painted. */
export interface Stroke {
    points: Point[];
    width: number;
}

/** A leaf, as the ellipse it is painted as. */
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
     * The same as the diameter until the base is switched on, at which point the
     * tabs hang below the circle and the piece is taller than it is wide. The
     * export has to be that tall or the tabs come out clipped.
     */
    height: number;
    /** the border band; null when there is none */
    ring: { inner: number; outer: number } | null;
    /** trunk, branches and roots, to be painted and merged into one silhouette */
    aStroke: Stroke[];
    aLeaf: Leaf[];
    /** the tabs under the disc that drop into the feet */
    aTab: Point[][];
    /** engraved decoration inside the border band */
    aBorderLine: Point[][];
    /** the feet, laid out side by side on their own little sheet */
    feet: { rings: Point[][]; width: number; height: number } | null;
    /** the leaf size actually used, which is never below the floor */
    leafSize: number;
    branchCount: number;
    leafCount: number;
    /** the thinnest branch, mm — the first thing to snap */
    thinnest: number;
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
 * A branch: an arc of a curve rather than a straight line.
 *
 * A tree drawn with straight segments reads as a diagram of a tree. The bend is
 * a constant turn along the length, which is the cheapest thing that looks
 * grown — and it is sampled finely enough that painting it as a thick polyline
 * leaves no facets at any size this gets cut at.
 */
const limb = (from: Point, angle: number, length: number, curl: number, segs = 10): Point[] => {
    const out: Point[] = [from];
    let x = from.x,
        y = from.y,
        a = angle;
    for (let i = 0; i < segs; i++) {
        a += curl / segs;
        x += (length / segs) * Math.cos(a);
        y += (length / segs) * Math.sin(a);
        out.push({ x, y });
    }
    return out;
};

/** The shortest signed way round from one angle to another, in (−π, π]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Where a limb ends up, and which way it was going when it got there. */
const tipOf = (a: Point[]): { p: Point; angle: number } => {
    const p = a[a.length - 1]!,
        q = a[Math.max(0, a.length - 2)]!;
    return { p, angle: Math.atan2(p.y - q.y, p.x - q.x) };
};

/**
 * How far a limb may run from `from`, heading `angle`, before it meets the reach
 * circle.
 *
 * The chain of limbs off one fork adds up to exactly the budget it was given —
 * each level takes 46 % and passes the rest on, and 0.46/(1−0.54) is 1 — so the
 * budget *is* the distance the outermost tip travels. Handing every fork the
 * same number therefore only works if every fork is in the middle of the disc,
 * and none of them is: the crown starts above the centre and the roots below it,
 * and a limb leaving either one sideways has half a disc more room than a limb
 * leaving it outwards. Given one number for all of them, the sideways limbs come
 * up short and the outward ones walk out through the rim — which is a tree wider
 * than the disc it is supposed to be inside.
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
// The border
//
// Four styles, and the difference between them is not decoration for its own
// sake — it is how much material the ring has in it. A plain band is the
// strongest and the dullest; a knot is the handsomest and is a band with holes
// cut in it. On a small disc that matters, so the tool says which is which.
// ---------------------------------------------------------------------------

/** Points round a circle, for a decoration line. */
const wave = (
    cx: number,
    cy: number,
    rMid: number,
    amp: number,
    lobes: number,
    phase: number,
    segs: number
): Point[] =>
    Array.from({ length: segs + 1 }, (_, i) => {
        const t = i / segs,
            a = 2 * Math.PI * t,
            r = rMid + amp * Math.sin(lobes * a + phase);
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

/**
 * The lines engraved inside the border band.
 *
 * `braid` and `rope` are two and three strands that weave across each other,
 * which is what a Celtic border is when it is drawn rather than carved. `knot`
 * adds the little circles that sit where the strands cross, which is the detail
 * that makes it read as knotwork instead of as a sine wave.
 */
const borderLines = (
    cx: number,
    cy: number,
    inner: number,
    outer: number,
    style: BorderStyle,
    lobes: number
): Point[][] => {
    if (style === "none" || style === "plain") return [];
    const rMid = (inner + outer) / 2,
        amp = (outer - inner) * 0.28,
        segs = Math.max(180, lobes * 24),
        out: Point[][] = [];

    if (style === "rope") {
        // Three strands at even phase: a cable rather than a plait.
        for (let k = 0; k < 3; k++) out.push(wave(cx, cy, rMid, amp, lobes, (2 * Math.PI * k) / 3, segs));
        return out;
    }

    // Two strands crossing, for both braid and knot.
    out.push(wave(cx, cy, rMid, amp, lobes, 0, segs));
    out.push(wave(cx, cy, rMid, amp, lobes, Math.PI, segs));

    if (style === "knot") {
        // A small ring at every crossing — where the two strands are both at
        // the middle radius, which is twice per lobe.
        const rDot = Math.min((outer - inner) * 0.16, (Math.PI * rMid) / (lobes * 2) * 0.34);
        for (let k = 0; k < lobes * 2; k++) {
            const a = (Math.PI * k) / lobes + Math.PI / (2 * lobes);
            out.push(circleRing(cx + rMid * Math.cos(a), cy + rMid * Math.sin(a), Math.max(0.3, rDot)));
        }
    }
    return out;
};

// ---------------------------------------------------------------------------
// Something to stand it on
//
// A disc this size does not stand up, so it gets two tabs underneath and two
// feet with slots in them. The tabs are painted into the union along with
// everything else, so they are part of the disc's own outline rather than
// another piece to glue on — and the slot is the tab plus the kerf, because a
// slot cut to the nominal thickness is a slot the tab does not go into.
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
     * the circle, so a tab measured from there is shorter than the rim it has to
     * clear: the disc lands on its own edge and the slots never see it. This is
     * the part that sticks out past the bottom of the circle, so it is the part
     * that goes through the foot, and it is the sheet plus enough to stand
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

export const buildCelticTree = (opt: CelticOptions): CelticResult => {
    const L = CELTIC_LIMITS,
        warnings: string[] = [],
        size = clamp(opt.size, L.minSize, L.maxSize),
        R = size / 2,
        centre: Point = { x: R, y: R },
        branches = Math.round(clamp(opt.branches, L.minBranches, L.maxBranches)),
        depth = Math.round(clamp(opt.depth, L.minDepth, L.maxDepth)),
        twist = clamp(opt.twist, 0, 1),
        next = rng(opt.seed);

    // ── the ring ────────────────────────────────────────────────────────
    const hasRing = opt.border !== "none",
        bw = hasRing ? clamp(opt.borderWidth, 1, R * 0.5) : 0,
        outer = R,
        inner = R - bw,
        ring = hasRing ? { inner, outer } : null,
        // What the branches have to fill. With a ring they grow into it and
        // merge with it; without one they stop just short of the edge.
        reach = hasRing ? inner + bw * 0.55 : R * 0.94;

    // ── the trunk ───────────────────────────────────────────────────────
    //
    // It stands **on the ring**. The first version had it floating in the middle
    // of the disc with the roots hanging below it, and that is the one thing
    // everybody notices first: a tree grows out of the ground, and here the
    // ground is the bottom of the band. A trunk that starts halfway up reads as
    // a shrub in a hoop.
    //
    // It is also the only stroke in the drawing that tapers, laid down as a run
    // of overlapping round-capped segments. A constant-width trunk is a post; a
    // tree is fat where it meets the ground and half that by the first fork.
    const trunkW = clamp(opt.trunk, 1, R * 0.4),
        forkY = centre.y - R * 0.18,
        // The foot is a shade over twice `trunkW` across with a round cap, so its
        // centreline
        // has to stop a half-width short of the rim or the widest stroke in the
        // drawing puts a bulge on the outside edge of the disc.
        footY = Math.min(centre.y + reach, centre.y + R - trunkW * 1.08),
        // Where the roots leave it: low, but clear of the foot, so they spread
        // sideways along the bottom of the ring rather than out of its very end.
        rootY = centre.y + (footY - centre.y) * 0.45;

    const aStroke: Stroke[] = [],
        aLeaf: Leaf[] = [];
    let thinnest = trunkW,
        branchCount = 1;

    /** A run of points laid down as overlapping segments of changing width. */
    const emit = (aPt: Point[], w0: number, w1: number): void => {
        for (let i = 0; i < aPt.length - 1; i++) {
            const t = (i + 0.5) / (aPt.length - 1);
            aStroke.push({ points: [aPt[i]!, aPt[i + 1]!], width: w0 + (w1 - w0) * t });
        }
    };

    // Not quite straight: a trunk drawn with a ruler is a post whatever width
    // it is.
    emit(
        Array.from({ length: 17 }, (_, i) => {
            const t = i / 16;
            return {
                x: centre.x + Math.sin(t * 2.4 + 0.7) * trunkW * 0.20,
                y: footY + (forkY - footY) * t
            };
        }),
        trunkW * 2.12,
        trunkW * 0.74
    );

    // ── leaves ──────────────────────────────────────────────────────────
    //
    // Worked out here rather than after the tree is grown, because a leaf hangs
    // off a *twig* and only `grow` knows which limbs are twigs. Picking them
    // afterwards meant matching stroke widths against a constant, which is a
    // filter that silently selects nothing the moment the taper changes.
    const leafSize = Math.max(L.minLeaf, clamp(opt.leafSize, 0, R));
    if (opt.leaves && opt.leafSize < L.minLeaf) {
        warnings.push(
            `Leaves under ${mm(L.minLeaf)} come off the bed as scorch marks rather than leaves, so they have been `
            + `grown to ${mm(leafSize)}. The beam and the char it leaves are each about a tenth of a millimetre `
            + "wide, and a leaf has to be a good deal bigger than the hole that makes it."
        );
    }

    /**
     * One leaf, hung off a point on a twig and pointing away from it.
     *
     * Offset by half its own length, so the leaf's *stalk end* is on the twig
     * and the rest of it sticks out. Centred on the twig instead — which is what
     * it used to be — the whole leaf is swallowed by the branch when the two are
     * merged, and a canopy of forty of them shows up as a slightly lumpy stick.
     */
    const leafAt = (at: Point, along: number, spread: number): void => {
        const a = along + (next() - 0.5) * spread,
            // Upwards only. Varying either way would put the smallest leaves
            // below the floor, which is the one thing the floor is for.
            len = leafSize * (1 + 0.5 * next());
        aLeaf.push({
            x: at.x + Math.cos(a) * len * 0.5,
            y: at.y + Math.sin(a) * len * 0.5,
            angle: a,
            length: len,
            width: len * 0.42
        });
    };

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
        return wrap(toward - a) * (0.18 + 0.30 * twist) + (next() - 0.5) * 0.5 * twist;
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
     * Two, always. `branches` is how many primaries leave the trunk, not how
     * many ways every fork splits — with a three-way split four levels deep the
     * crown has eighty-one tips, they all have to land on the same ring, and
     * what arrives is a comb rather than a tree. Binary forking gives
     * `branches × 2^(depth−1)` of them, which at the defaults is thirty-two:
     * enough to fill a disc, few enough that you can see between them.
     */
    const grow = (
        from: Point,
        angle: number,
        width: number,
        level: number,
        budget: number,
        leafy: boolean
    ): void => {
        // Whichever is smaller: what is left of the chain's allowance, or the
        // room this limb actually has in front of it — see `roomFor`.
        // Re-measured at every fork, because a child heads somewhere its parent
        // was not.
        const span = Math.min(budget, roomFor(from, angle, centre, reach)),
            last = level >= depth,
            // Only some of the last twigs turn out and land on the ring. Those
            // are the join, and there are far more of them than the piece needs
            // — the trunk stands on the band and the roots run into it either
            // side. The rest are free ends that droop, which is what stops the
            // canopy looking like a diagram.
            reaching = last && next() < 0.55,
            curl = last
                ? (reaching ? outwardCurl(from, angle) : droopCurl(angle))
                : curlFor(angle);

        // A limb that turns as it grows covers less ground than its own length:
        // an arc of length L bending through θ spans L·sin(θ/2)/(θ/2). A limb
        // that has to *land* on the ring is therefore given the length that
        // gets it there rather than the distance it has to travel. A flat
        // allowance was the first attempt and it is wrong in both directions —
        // too little for a limb that turns hard, and a straight overshoot out
        // through the rim for one that does not turn at all, which is what
        // happens with the wander set to zero.
        //
        // Everything before the last takes an even share of what is left, so
        // the forks land at regular intervals along the radius. Halving at
        // every level is the obvious thing and it is wrong too: the first limb
        // takes half the disc on its own, and everything interesting then
        // happens in a knot at the far end of four long straight spokes.
        const bend = Math.abs(curl) / 2,
            chord = bend < 1e-3 ? 1 : Math.sin(bend) / bend,
            len = last
                ? (reaching ? span / Math.max(0.5, chord) : span * (0.42 + 0.42 * next()))
                : span / (depth - level + 1),
            a = clipToReach(limb(from, angle, len, curl)),
            tip = tipOf(a);

        aStroke.push({ points: a, width });
        thinnest = Math.min(thinnest, width);
        branchCount++;

        // Leaves on the outer two levels: one at the very end of a twig and one
        // or two along its length, off to alternating sides. All at the tip is a
        // lollipop; all along the middle and the tips look bitten off.
        if (leafy && opt.leaves && level >= depth - 1) {
            leafAt(tip.p, tip.angle, 0.7);
            const many = 1 + (next() < 0.5 ? 1 : 0);
            for (let k = 0; k < many; k++) {
                const i = Math.floor(a.length * (0.35 + 0.3 * k + 0.2 * next())),
                    at = a[Math.min(a.length - 1, Math.max(1, i))]!,
                    was = a[Math.min(a.length - 1, Math.max(1, i)) - 1]!,
                    along = Math.atan2(at.y - was.y, at.x - was.x);
                leafAt(at, along + (k % 2 === 0 ? 1 : -1) * (0.9 + 0.5 * next()), 0.5);
            }
        }
        if (last) return;

        // Wander, not symmetry. The two children used to leave at exactly ±half
        // the spread, and a tree where every fork is a perfect Y is a diagram of
        // a tree. Each side now gets its own share of the fan.
        const spread = 0.55 + 0.5 * twist;
        for (const side of [-1, 1]) {
            const share = spread * (0.35 + 0.65 * next()),
                jitter = (next() - 0.5) * 0.55 * twist;
            grow(tip.p, tip.angle + side * share + jitter, width * 0.74, level + 1, span - len, leafy);
        }
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
     * The fix is not to bend the limbs harder but to move where they start:
     * the flatter a primary is aimed, the further down the trunk it leaves
     * from. Which is also simply what a tree does — branches do not all come
     * off at one point, and a drawing where they do looks like a hand of cards.
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
        leafy: boolean
    ): void => {
        for (let i = 0; i < count; i++) {
            const t = count === 1 ? 0.5 : i / (count - 1),
                // 0 for the primary aimed straight along, 1 for the flattest.
                out = Math.abs(t - 0.5) * 2,
                at: Point = {
                    x: from.x + (toward.x - from.x) * out * 0.55,
                    y: from.y + (toward.y - from.y) * out * 0.55
                };
            grow(at, aim + (t - 0.5) * sweep + (next() - 0.5) * 0.2 * twist, width, level, budget, leafy);
        }
    };

    // The crown: `branches` primaries aimed up and swept across the top. The
    // flattest of them leave the trunk part of the way back down towards the
    // roots, which is what puts something in the shoulders of the disc.
    fan(
        { x: centre.x, y: forkY },
        { x: centre.x, y: rootY },
        -Math.PI / 2,
        Math.PI * 0.88,
        branches,
        trunkW * 0.66,
        1,
        reach * 1.05,
        true
    );

    // The roots. They leave the trunk low down and spread *sideways* along the
    // bottom of the ring rather than downwards — there is no downwards left,
    // because the trunk is already standing on the band. The sweep is wider
    // than a half-turn so the outermost pair start above the horizontal and
    // curl down into the rim, which is how the bottom corners get filled.
    if (opt.roots) {
        fan(
            { x: centre.x, y: rootY },
            { x: centre.x, y: footY },
            Math.PI / 2,
            Math.PI * 1.10,
            branches + 1,
            trunkW * 0.52,
            2,
            (reach - (rootY - centre.y)) * 1.2,
            // No leaves on the roots. Obvious once it is on the screen, and the
            // first version put them there because it picked twigs by their
            // width afterwards and a root twig is the same width as a branch
            // twig.
            false
        );
    }

    // Leaves that would poke out through the ring are worse than no leaves:
    // they turn the outside edge into a row of bumps.
    const kept = aLeaf.filter(o => Math.hypot(o.x - centre.x, o.y - centre.y) + o.length / 2 <= reach + 0.01);
    aLeaf.length = 0;
    aLeaf.push(...kept);

    // ── the border decoration ───────────────────────────────────────────
    //
    // The number of lobes follows the circumference rather than being a knob:
    // a knot with the same number of crossings at 60 mm and at 300 mm is either
    // a scribble or a row of sausages, and never both right.
    const lobes = Math.max(6, Math.round((Math.PI * (inner + outer)) / Math.max(6, bw * 3.2)));
    const aBorderLine = hasRing ? borderLines(centre.x, centre.y, inner, outer, opt.border, lobes) : [];

    // ── the base ────────────────────────────────────────────────────────
    const aTab: Point[][] = [],
        plan = tabPlan(R, opt.thickness);
    let feet: CelticResult["feet"] = null;
    if (opt.base) {
        for (const s of [-1, 1]) {
            const cx = centre.x + s * plan.spread,
                // Started inside the ring so the tab merges with it rather than
                // touching it at a tangent, which would be a hairline joint.
                y0 = centre.y + Math.sqrt(Math.max(0, R * R - plan.spread * plan.spread)) - bw * 0.4;
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

    // ── sanity ──────────────────────────────────────────────────────────
    if (thinnest < 1) {
        warnings.push(
            `The outermost twigs are ${mm(thinnest)} across. Cut, they snap while you are lifting the piece off `
            + "the bed — raise the trunk width, or take a level off the depth."
        );
    } else if (thinnest < 1.8) {
        warnings.push(`The outermost twigs are ${mm(thinnest)} across, which is delicate in anything but plywood.`);
    }
    if (!hasRing) {
        warnings.push(
            "With no border the branches end in mid-air, so every twig is a cantilever and the piece has no rim to "
            + "pick it up by. It engraves well and cuts badly."
        );
    }
    if (hasRing && bw < 2) {
        warnings.push(`A ${mm(bw)} border is the whole edge of the piece, and it is what everything hangs off.`);
    }
    if (opt.border === "knot" && bw < 6) {
        warnings.push(
            `Knotwork in a ${mm(bw)} band engraves as a smudge — the crossings are closer together than the beam is `
            + "wide. Widen the border, or use the plain one."
        );
    }
    if (opt.base && opt.thickness < 2) {
        warnings.push(`A ${mm(opt.thickness)} sheet makes a tab that snaps in the slot the first time it is lifted.`);
    }
    if (opt.base && !hasRing) {
        warnings.push(
            "The tabs hang off the rim, and with no border there is no rim: they come out as two loose rectangles "
            + "beside a tree. Turn a border on, or turn the base off."
        );
    }
    if (branchCount > 400) {
        warnings.push(
            `${branchCount} branches is a lot of path for the head to follow, and at this size most of them lie on `
            + "top of each other. Fewer splits, or fewer levels."
        );
    }

    return {
        size,
        height: opt.base ? centre.y + R + plan.stand : size,
        ring,
        aStroke,
        aLeaf,
        aTab,
        aBorderLine,
        feet,
        leafSize,
        branchCount,
        leafCount: aLeaf.length,
        thinnest,
        warnings
    };
};

/**
 * One leaf as the closed ring it is painted as.
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
