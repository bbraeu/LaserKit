import { arcSegments, circleRing, dedupe, pathData, r3, rectRing, ringBounds, shiftRing } from "./design";
import { OPERATION_COLORS, buildDxf } from "./dxf";
import type { DxfEntity, Operation, Point } from "./dxf";
import { buildFds } from "./fds";

// ---------------------------------------------------------------------------
// Finger-jointed boxes, cut flat.
//
// A box is the one thing a laser makes that has to be *right* rather than
// pretty: six plates that only become a box if every tooth lands in the gap
// opposite it. So the whole file is built around one idea — an edge profile —
// and every panel is four of them walked in a circle.
//
//   · a MALE edge has fingers standing t proud of the panel's rectangle;
//   · a FEMALE edge has notches cut t into it;
//   · a FLAT edge is a straight line.
//
// The rectangle a panel is generated from is its outer face *minus t on every
// male side*, so the fingers put the missing millimetres back and the assembled
// box measures exactly what was typed. Two panels meeting at an edge run the
// same length through the same segment count, so their patterns are each
// other's negative by construction rather than by agreement.
//
// Every pattern is also a palindrome — equal segments, symmetric parity — which
// is what lets the left wall and the right wall be the same part flipped over,
// and lets an edge walked bottom-to-top mate with one walked top-to-bottom.
//
// Two parities are in use, and the difference matters:
//
//   · wall → bottom/top joints start and end with a *finger*, so the four
//     corner squares of the base plate are filled by the side walls' end
//     fingers (which is why the base plate's corners are cut away);
//   · wall → wall corner joints start and end *recessed*, so the rim of an open
//     box is a clean rectangle instead of four little tabs.
//
// Kerf is not decoration here. The beam removes about 0.15 mm of wood, so a
// finger cut to size comes out 0.15 mm small and its slot 0.15 mm large — 0.3 mm
// of slop per joint, which is the difference between a box you tap together and
// one you glue and clamp. Every finger is drawn half a kerf oversize and every
// notch half a kerf undersize, and the fit gap on top of that is yours to set.
// ---------------------------------------------------------------------------

/** Everything is cut; only glue and hinge positions are marked. */
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

/** What the inspector's sliders and this file's clamps agree on. */
export const BOX_LIMITS = {
    minSize: 15,
    maxSize: 1200,
    minThickness: 0.8,
    maxThickness: 25,
    maxKerf: 1,
    maxClearance: 0.5,
    minFinger: 3,
    maxFinger: 60,
    maxDividers: 10,
    minSheet: 100,
    maxSheet: 2000,
    maxLidClearance: 2,
    maxOffset: 60
} as const;

/** A finger about three times the sheet thickness is the woodworking rule. */
const FINGER_PER_THICKNESS = 3;
const AUTO_FINGER_MIN = 6;
const AUTO_FINGER_MAX = 20;

/** Never fewer than one finger, never a comb too fine to survive cutting. */
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 51;

/** A pivot has to turn, so its hole is cut this much over the pin. */
const PIN_PLAY = 0.15;

/** Clear space kept between the hinge knuckle and the corner joint above it. */
const LOBE_MARGIN = 2;

export type LidType = "none" | "finger" | "layon" | "tray" | "hinged";

/** Where the bottom (and a finger-jointed top) meets the walls. */
export type PanelJoint = "edge" | "offset";

export type DimMode = "outer" | "inner";

export interface BoxOptions {
    /** whether width/depth/height describe the outside or the usable inside */
    dims: DimMode;
    width: number;
    depth: number;
    height: number;
    thickness: number;
    /** beam width, mm — fingers grow by half of it, notches shrink by half */
    kerf: number;
    /** extra gap per finger side on top of the kerf; 0 is a tap-together fit */
    clearance: number;
    /** target finger width, mm; 0 = three times the thickness */
    finger: number;
    lid: LidType;
    /** bottom flush with the walls' edge, or inset by `panelOffset` */
    panelJoint: PanelJoint;
    panelOffset: number;
    /** play around a lay-on lid's lip or a tray lid's walls, per side */
    lidClearance: number;
    /** a lay-on lid gets a plate glued under it that locates in the opening */
    lidLip: boolean;
    /** outer height of a tray or hinged lid */
    lidHeight: number;
    /** hinge pin / screw diameter */
    pin: number;
    /** how far behind the back face the hinge pivot sits */
    hingeOffset: number;
    /** dividers running front to back — they split the width */
    dividersW: number;
    /** dividers running left to right — they split the depth */
    dividersD: number;
    /** divider height, mm; 0 = up to the rim */
    dividerHeight: number;
    /** parts are nested in rows no wider than this */
    sheetWidth: number;
    /** space kept between parts on the sheet */
    gap: number;
    /** name each part on the preview — a view aid, never cut */
    labels: boolean;
}

export interface BoxPart {
    label: string;
    /** what it is and how big, for the parts list */
    note: string;
    width: number;
    height: number;
}

export interface BoxLayer {
    operation: Operation;
    rings: Point[][];
}

export interface BoxResult {
    /** the nested sheet, with part names when they were asked for */
    preview: string;
    aLayer: BoxLayer[];
    /** the nested sheet's size, mm */
    width: number;
    height: number;
    aPart: BoxPart[];
    outer: { w: number; d: number; h: number };
    /** the usable space inside the closed box, mm */
    inner: { w: number; d: number; h: number };
    /**
     * How deep the open half is — the same as the inner height for every box
     * except a clamshell, where half the room is in the lid. This is what a
     * divider can stand in.
     */
    wellDepth: number;
    /** closed cut contours */
    pieces: number;
    points: number;
    /** how far the head travels cutting, mm */
    cutLength: number;
    /** the finger width the joints came out at */
    finger: number;
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const mm = (n: number): string => `${Math.round(n * 10) / 10} mm`;

const size = (w: number, h: number): string => `${mm(w)} × ${mm(h)}`;

interface Part {
    label: string;
    note: string;
    cut: Point[][];
    engrave: Point[][];
}

/** Every number the joints are cut from, worked out once. */
interface Cut {
    t: number;
    kerf: number;
    /** a finger grows this much on each side: half a kerf, less the fit gap */
    growM: number;
    /** a notch shrinks by half a kerf on each side */
    growF: number;
    /** target finger width */
    finger: number;
    joint: PanelJoint;
    /** how far in from the edge an inset panel sits */
    offset: number;
}

// ---------------------------------------------------------------------------
// Edge profiles
//
// An edge is described in its own two coordinates: `a` runs along it from the
// starting corner, `o` stands out of it (positive = away from the panel). That
// makes a finger pattern one array of steps, and makes the same code serve all
// four sides of every panel.
// ---------------------------------------------------------------------------

type EdgeKind = "flat" | "male" | "female";

interface Joint {
    kind: EdgeKind;
    /** the whole edge, corner to corner */
    length: number;
    /** the joint occupies [from, to]; the rest of the edge sits at `outside` */
    from: number;
    to: number;
    outside: number;
    /** how far a finger stands out, or a notch cuts in */
    depth: number;
    /** segments — always odd, so both ends of the joint are the same kind */
    n: number;
    /** true when segment 0 is a finger (male) or a notch (female) */
    endsActive: boolean;
    /** each active span grows by this on both sides */
    grow: number;
    /** a hinge knuckle bulging out of the flat part of this edge */
    lobe?: { at: number; radius: number; standoff: number };
}

/**
 * Segments a joint of this length wants. Odd, so whichever kind the first
 * segment is the last one is too — which is what decides whether a corner is
 * filled or open, and has to be the same on both panels of the joint.
 */
export const fingerSegments = (length: number, target: number): number => {
    const raw = Math.max(1, Math.round(length / Math.max(0.5, target))),
        n = raw % 2 === 1 ? raw : raw + 1;
    return Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, n));
};

/** Where the fingers (or notches) fall, with the kerf already in them. */
const jointSegments = (j: Joint, grow = j.grow): { s: number; e: number; active: boolean }[] => {
    const step = (j.to - j.from) / j.n,
        isActive = (i: number): boolean => (i % 2 === 0) === j.endsActive,
        aB: number[] = [];

    for (let i = 0; i <= j.n; i++) {
        // The two outermost boundaries are the joint's own ends and stay put:
        // moving them would resize the panel rather than the joint.
        const b = j.from + i * step;
        aB.push(i > 0 && i < j.n ? b + (isActive(i - 1) ? grow : -grow) : b);
    }
    return Array.from({ length: j.n }, (_, i) => ({ s: aB[i]!, e: aB[i + 1]!, active: isActive(i) }));
};

/** The staircase this edge is cut as, from corner to corner. */
const jointProfile = (j: Joint): { a: number; o: number }[] => {
    const out: { a: number; o: number }[] = [],
        push = (a: number, o: number): void => {
            const last = out[out.length - 1];
            if (last && Math.abs(last.a - a) < 1e-9 && Math.abs(last.o - o) < 1e-9) return;
            out.push({ a, o });
        };

    if (j.kind === "flat") {
        push(0, 0);
        push(j.length, 0);
    } else {
        const level = j.kind === "male" ? j.depth : -j.depth;
        // A joint that runs right into the corner must *stay* at whatever the
        // last segment was: stepping back to the rectangle first would leave
        // the corner square in place, and it is precisely that square the
        // neighbouring panel's end finger has to occupy.
        if (j.from > 1e-9) {
            push(0, j.outside);
            push(j.from, j.outside);
        }
        for (const s of jointSegments(j)) {
            push(s.s, s.active ? level : 0);
            push(s.e, s.active ? level : 0);
        }
        if (j.to < j.length - 1e-9) {
            push(j.to, j.outside);
            push(j.length, j.outside);
        }
    }

    if (!j.lobe) return out;

    // The hinge knuckle: a disc whose centre sits *outside* the edge, so what
    // shows is the part of it standing proud — a mushroom head the pivot turns
    // in. It replaces the straight run between the two points where the circle
    // crosses the edge, and deliberately overhangs the edge on both sides of
    // that chord: that overhang is what stops the pin tearing out sideways.
    const { at, radius: R, standoff: g } = j.lobe,
        half = Math.sqrt(Math.max(0, R * R - g * g)),
        skew = Math.asin(Math.min(1, g / R)),
        f0 = Math.PI + skew,
        f1 = -skew,
        segs = arcSegments(R, f0 - f1),
        arc: { a: number; o: number }[] = [];

    for (let i = 0; i <= segs; i++) {
        const f = f0 + (f1 - f0) * (i / segs);
        arc.push({ a: at + R * Math.cos(f), o: g + R * Math.sin(f) });
    }
    return [
        ...out.filter(p => p.a <= at - half + 1e-9),
        ...arc,
        ...out.filter(p => p.a >= at + half - 1e-9)
    ];
};

/**
 * A panel: a rectangle whose four edges are joints, walked clockwise from the
 * top-left. Where two edges meet, the corner is displaced by *both* of their
 * end offsets — which is what cuts the little square out of a base plate's
 * corner without anybody having to ask for it.
 */
const panelRing = (w: number, h: number, aJoint: Joint[]): Point[] => {
    const aC: Point[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
        aD: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
        aN: Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }],
        aProf = aJoint.map(jointProfile),
        ring: Point[] = [];

    for (let k = 0; k < 4; k++) {
        const prof = aProf[k]!,
            prev = aProf[(k + 3) % 4]!,
            nPrev = aN[(k + 3) % 4]!,
            n = aN[k]!,
            d = aD[k]!,
            c = aC[k]!,
            oPrev = prev[prev.length - 1]!.o,
            oHere = prof[0]!.o;

        ring.push({ x: c.x + oPrev * nPrev.x + oHere * n.x, y: c.y + oPrev * nPrev.y + oHere * n.y });
        for (let i = 1; i < prof.length - 1; i++) {
            const p = prof[i]!;
            ring.push({ x: c.x + p.a * d.x + p.o * n.x, y: c.y + p.a * d.y + p.o * n.y });
        }
    }
    return dedupe(ring);
};

/**
 * A span given in panel coordinates, in the coordinates the edge is walked in.
 * Edges 2 and 3 run backwards round the rectangle, so a joint that does not
 * cover the whole edge — the one a hinge knuckle has pushed out of the way —
 * has to be turned round to stay opposite its partner.
 */
const onEdge = (k: number, len: number, from: number, to: number): { from: number; to: number } =>
    k < 2 ? { from, to } : { from: len - to, to: len - from };

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

interface WallSpec {
    /** how wide the wall's own rectangle is */
    span: number;
    /** and how tall */
    height: number;
    /** the two upright corner joints */
    vertical: EdgeKind;
    /**
     * How far down each upright joint reaches, measured from the top of the
     * rectangle. They are separate because a hinge knuckle takes over the
     * bottom of one edge and not the other, and the panel opposite has to stop
     * at exactly the same place.
     */
    vTo1: number;
    vTo3: number;
    top: EdgeKind;
    bottom: EdgeKind;
    lobe?: { at: number; radius: number; standoff: number };
    /** which upright edge the knuckle sits on: 1 = right, 3 = left */
    lobeEdge?: number;
}

const wallRing = (c: Cut, o: WallSpec): Point[] => {
    const nH = fingerSegments(o.span, c.finger),
        horizontal = (kind: EdgeKind): Joint => ({
            kind,
            length: o.span,
            from: 0,
            to: o.span,
            outside: 0,
            depth: c.t,
            n: nH,
            // Filled corners: the side walls' end fingers are what plug the
            // four corner squares of the base plate.
            endsActive: true,
            grow: kind === "male" ? c.growM : c.growF
        }),
        upright = (k: number, to: number): Joint => {
            const span = onEdge(k, o.height, 0, to);
            return {
                kind: o.vertical,
                length: o.height,
                from: span.from,
                to: span.to,
                outside: 0,
                depth: c.t,
                n: fingerSegments(to, c.finger),
                // Open corners: a tab standing off the rim of an open box is
                // both ugly and easy to snap.
                endsActive: false,
                grow: o.vertical === "male" ? c.growM : c.growF,
                lobe: o.lobeEdge === k ? o.lobe : undefined
            };
        };

    return panelRing(o.span, o.height, [
        horizontal(o.top), upright(1, o.vTo1), horizontal(o.bottom), upright(3, o.vTo3)
    ]);
};

/** The base (or lid) plate, notched all round for the walls' fingers. */
const capRing = (c: Cut, W: number, D: number): Point[] => {
    const across = (): Joint => ({
        kind: "female",
        length: W,
        // The front and back walls stop a thickness short of the corner, so
        // their joint does too; the corners themselves belong to the side
        // walls, whose end notches take them out.
        from: c.t,
        to: W - c.t,
        outside: -c.t,
        depth: c.t,
        n: fingerSegments(W - 2 * c.t, c.finger),
        endsActive: true,
        grow: c.growF
    }),
        along = (): Joint => ({
            kind: "female",
            length: D,
            from: 0,
            to: D,
            outside: 0,
            depth: c.t,
            n: fingerSegments(D, c.finger),
            endsActive: true,
            grow: c.growF
        });
    return panelRing(W, D, [across(), along(), across(), along()]);
};

/** An inset base (or lid) plate: through-tenons into mortises in the walls. */
const tenonRing = (c: Cut, W: number, D: number): Point[] => {
    const edge = (len: number): Joint => ({
        kind: "male",
        length: len,
        from: 0,
        to: len,
        outside: 0,
        depth: c.t,
        n: fingerSegments(len, c.finger),
        // Recessed ends keep the plate's own corners square, so it drops in
        // without four little spurs to line up at once.
        endsActive: false,
        grow: c.growM
    });
    return panelRing(W - 2 * c.t, D - 2 * c.t, [edge(W - 2 * c.t), edge(D - 2 * c.t), edge(W - 2 * c.t), edge(D - 2 * c.t)]);
};

/** Where an inset plate's tenons fall, at nominal size, along one direction. */
const tenonSpans = (c: Cut, len: number): { s: number; e: number }[] =>
    jointSegments({
        kind: "male", length: len, from: 0, to: len, outside: 0, depth: c.t,
        n: fingerSegments(len, c.finger), endsActive: false, grow: 0
    }, 0).filter(s => s.active).map(s => ({ s: s.s, e: s.e }));

/** A mortise: the hole a through-tenon passes into, half a kerf undersize. */
const mortise = (c: Cut, x0: number, x1: number, y0: number, y1: number): Point[] =>
    rectRing({ x0: x0 + c.kerf / 2, y0: y0 + c.kerf / 2, x1: x1 - c.kerf / 2, y1: y1 - c.kerf / 2 }, 0);

/** A hole that comes out the diameter asked for once the beam has been paid for. */
const hole = (c: Cut, x: number, y: number, diameter: number, play = 0): Point[] =>
    circleRing(x, y, Math.max(0.2, (diameter + play - c.kerf) / 2));

/** A plate with cross-lap slots cut in from its top and bottom edges. */
const slottedPlate = (w: number, h: number, aTop: number[], aBottom: number[], slot: number, depth: number): Point[] => {
    const out: Point[] = [{ x: 0, y: 0 }];
    for (const x of aTop) {
        out.push({ x: x - slot / 2, y: 0 }, { x: x - slot / 2, y: depth }, { x: x + slot / 2, y: depth }, { x: x + slot / 2, y: 0 });
    }
    out.push({ x: w, y: 0 }, { x: w, y: h });
    for (const x of [...aBottom].reverse()) {
        out.push({ x: x + slot / 2, y: h }, { x: x + slot / 2, y: h - depth }, { x: x - slot / 2, y: h - depth }, { x: x - slot / 2, y: h });
    }
    out.push({ x: 0, y: h });
    return dedupe(out);
};

// ---------------------------------------------------------------------------
// The hinge
//
// A lid can only swing if nothing on it dips into the box on the way, and the
// only pivot position where that is true for every point at once is one *behind
// and above* the back rim: from there every point of the lid is down-and-left
// of the pin, and turning it lifts all of them. No clearance arcs, no notch in
// the rim, no fitting.
//
// Nothing of the box reaches that point, though — it hangs in the air behind
// the back wall. So the lid's own side walls grow a round knuckle out to it,
// and a pair of ears screwed to the outside of the box's side walls meet them
// there. Two plates in two planes with one pin through both: a strap hinge.
// ---------------------------------------------------------------------------

interface Hinge {
    /** the knuckle's radius */
    radius: number;
    /** how far behind the back face the pivot sits */
    standoff: number;
    /** how far above the joint line it sits — never less than the radius, or
        the knuckle would hang below the lid and foul the rim */
    rise: number;
    pin: number;
    /** where the ear is screwed on, measured back from the box's back face */
    mount: number;
    mountSpacing: number;
    /** and down from the rim */
    mountDrop: number;
}

const hingeOf = (opt: BoxOptions): Hinge => {
    const pin = clamp(opt.pin, 1.5, 10),
        standoff = clamp(opt.hingeOffset, 1, 30),
        radius = clamp(pin / 2 + 4, standoff + 2.5, 20);
    return {
        radius,
        standoff,
        rise: radius + 1,
        pin,
        mount: radius + 3,
        mountSpacing: Math.max(14, radius * 2.5),
        mountDrop: radius + 3
    };
};

/** The convex hull of a handful of points, counter-clockwise. */
const convexHull = (aP: Point[]): Point[] => {
    const a = [...aP].sort((p, q) => (p.x - q.x) || (p.y - q.y)),
        cross = (o: Point, p: Point, q: Point): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x),
        half = (aIn: Point[]): Point[] => {
            const out: Point[] = [];
            for (const p of aIn) {
                while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
                out.push(p);
            }
            out.pop();
            return out;
        };
    if (a.length < 3) return a;
    return [...half(a), ...half([...a].reverse())];
};

/** The outline of a set of equal discs welded together — the ear's shape. */
const discHull = (aP: Point[], r: number): Point[] => {
    const hull = convexHull(aP);
    if (hull.length < 2) return circleRing(hull[0]!.x, hull[0]!.y, r);

    const out: Point[] = [];
    for (let i = 0; i < hull.length; i++) {
        const p = hull[i]!,
            prev = hull[(i + hull.length - 1) % hull.length]!,
            next = hull[(i + 1) % hull.length]!,
            a0 = Math.atan2(p.y - prev.y, p.x - prev.x) - Math.PI / 2;
        let a1 = Math.atan2(next.y - p.y, next.x - p.x) - Math.PI / 2;
        while (a1 < a0) a1 += 2 * Math.PI;
        const segs = arcSegments(r, a1 - a0);
        for (let k = 0; k <= segs; k++) {
            const a = a0 + ((a1 - a0) * k) / segs;
            out.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) });
        }
    }
    return dedupe(out);
};

// ---------------------------------------------------------------------------
// Shells
//
// One four-walled box, open at either end or neither. The main box, a tray lid
// and the lid half of a clamshell are all the same thing at different sizes,
// which is why there is one builder and not three.
// ---------------------------------------------------------------------------

interface ShellSpec {
    W: number;
    D: number;
    H: number;
    bottom: boolean;
    top: boolean;
    /** "" for the box itself, "Lid " for a lid's own walls */
    prefix: string;
    /** the lid half of a clamshell: knuckles on the side walls */
    hinge?: Hinge;
    /** the base half: screw holes for the ears, this far below its own rim */
    earHoles?: Hinge;
}

const buildShell = (c: Cut, s: ShellSpec): Part[] => {
    const { t } = c,
        bEdge = c.joint === "edge",
        bBotEdge = s.bottom && bEdge,
        bTopEdge = s.top && bEdge,
        wallH = s.H - (bBotEdge ? t : 0) - (bTopEdge ? t : 0),
        fbSpan = s.W - 2 * t,
        lrSpan = s.D,
        name = (sName: string): string => `${s.prefix}${s.prefix ? sName.toLowerCase() : sName}`;

    // A knuckle needs the corner joint above it out of the way, so the upright
    // joints on the back of the box stop short of it. Clamped so that even a
    // lid too shallow to hold the pivot — which is warned about — still yields
    // geometry rather than an outline that turns itself inside out.
    const lobeAt = s.hinge
        ? clamp(wallH - s.hinge.rise, s.hinge.radius, Math.max(s.hinge.radius, wallH - s.hinge.radius))
        : 0,
        vBackTo = s.hinge
            ? Math.max(wallH / 3, lobeAt - s.hinge.radius - LOBE_MARGIN)
            : wallH;

    const aPart: Part[] = [];

    // ── the closing plates ──────────────────────────────────────────────
    const cap = (bTop: boolean): void => {
        const ring = bEdge ? capRing(c, s.W, s.D) : tenonRing(c, s.W, s.D),
            b = ringBounds([ring]);
        aPart.push({
            label: name(bTop ? "Top" : "Bottom"),
            note: bEdge
                ? `${size(s.W, s.D)} — notched all round; its corners are cut out because the side walls' end fingers fill them`
                : `${size(b.x1 - b.x0, b.y1 - b.y0)} — through-tenons into mortises ${mm(c.offset)} in from the ${bTop ? "top" : "bottom"}`,
            cut: [ring],
            engrave: []
        });
    };
    if (s.bottom) cap(false);

    // ── the four walls ──────────────────────────────────────────────────
    //
    // An inset plate does not notch the wall's edge, it passes *through* it, so
    // the wall needs a row of mortises wherever a plate sits.
    const mortisesFor = (bSide: boolean): Point[][] => {
        if (bEdge) return [];
        const aOut: Point[][] = [],
            // A side wall spans the full depth, so its coordinates start a
            // thickness before the plate's tenons do.
            shift = bSide ? t : 0,
            aSpan = tenonSpans(c, (bSide ? s.D : s.W) - 2 * t),
            aRow: number[] = [];

        if (s.bottom) aRow.push(wallH - c.offset - t);
        if (s.top) aRow.push(c.offset);
        for (const y of aRow) {
            for (const sp of aSpan) aOut.push(mortise(c, sp.s + shift, sp.e + shift, y, y + t));
        }
        return aOut;
    };

    const wall = (sName: string, span: number, vertical: EdgeKind, bBack: boolean, bSide: boolean): void => {
        const lobeEdge = bSide && s.hinge ? 1 : undefined,
            ring = wallRing(c, {
                span,
                height: wallH,
                vertical,
                // The back of the box is where the knuckle is, so both of the
                // back wall's uprights and the rear upright of each side wall
                // stop short of it — and stop at the same height as each other.
                vTo1: bSide || bBack ? vBackTo : wallH,
                vTo3: bBack ? vBackTo : wallH,
                top: bTopEdge ? "male" : "flat",
                bottom: bBotEdge ? "male" : "flat",
                lobe: lobeEdge !== undefined && s.hinge
                    ? { at: lobeAt, radius: s.hinge.radius, standoff: s.hinge.standoff }
                    : undefined,
                lobeEdge
            }),
            aHole: Point[][] = [...mortisesFor(bSide)];

        if (bSide && s.hinge) aHole.push(hole(c, span + s.hinge.standoff, lobeAt, s.hinge.pin, PIN_PLAY));
        if (bSide && s.earHoles) {
            const h = s.earHoles;
            aHole.push(hole(c, span - h.mount, h.mountDrop, h.pin));
            aHole.push(hole(c, span - h.mount - h.mountSpacing, h.mountDrop, h.pin));
        }

        const b = ringBounds([ring]);
        aPart.push({
            label: name(sName),
            note: `${size(b.x1 - b.x0, b.y1 - b.y0)} — ${vertical === "male" ? "fingers" : "notches"} on the upright edges`
                + (bSide && s.hinge ? ", with the hinge knuckle on the back edge" : "")
                + (bSide && s.earHoles ? ", drilled for the hinge ear" : ""),
            cut: [ring, ...aHole],
            engrave: []
        });
    };

    // The back wall differs from the front only when a hinge has shortened its
    // upright joints, but it is always its own part: two panels that are the
    // same shape are still two panels to cut.
    wall("Front", fbSpan, "male", false, false);
    wall("Back", fbSpan, "male", true, false);
    wall("Left", lrSpan, "female", false, true);
    wall("Right", lrSpan, "female", false, true);

    if (s.top) cap(true);
    return aPart;
};

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

const moveRings = (aRing: Point[][], dx: number, dy: number): Point[][] =>
    aRing.map(a => shiftRing(a, dx, dy));

interface Placed extends Part {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Shelf packing in build order: rows across the sheet, then down. */
const layOut = (aPart: Part[], sheet: number, gap: number): { aPlaced: Placed[]; width: number; height: number; over: number } => {
    const aBox = aPart.map(p => ringBounds([...p.cut, ...p.engrave])),
        over = aBox.filter(b => b.x1 - b.x0 > sheet).length,
        wMax = Math.max(sheet, ...aBox.map(b => b.x1 - b.x0));

    let x = 0, y = 0, hRow = 0, wUsed = 0;
    const aPlaced = aPart.map((p, i) => {
        const b = aBox[i]!,
            w = b.x1 - b.x0,
            h = b.y1 - b.y0;
        if (x > 0 && x + w > wMax + 1e-6) {
            x = 0;
            y += hRow + gap;
            hRow = 0;
        }
        const out: Placed = {
            ...p,
            cut: moveRings(p.cut, x - b.x0, y - b.y0),
            engrave: moveRings(p.engrave, x - b.x0, y - b.y0),
            x, y, w, h
        };
        x += w + gap;
        hRow = Math.max(hRow, h);
        wUsed = Math.max(wUsed, x - gap);
        return out;
    });

    return { aPlaced, width: wUsed, height: y + hRow, over };
};

const ringLength = (a: Point[]): number => {
    let n = 0;
    for (let i = 0; i < a.length; i++) {
        const p = a[i]!, q = a[(i + 1) % a.length]!;
        n += Math.hypot(q.x - p.x, q.y - p.y);
    }
    return n;
};

// ---------------------------------------------------------------------------
// The box
// ---------------------------------------------------------------------------

export const buildBox = (opt: BoxOptions): BoxResult => {
    const warnings: string[] = [],
        L = BOX_LIMITS,
        t = clamp(opt.thickness, L.minThickness, L.maxThickness),
        kerf = clamp(opt.kerf, 0, L.maxKerf),
        clearance = clamp(opt.clearance, 0, L.maxClearance),
        play = clamp(opt.lidClearance, 0, L.maxLidClearance),
        finger = opt.finger > 0
            ? clamp(opt.finger, L.minFinger, L.maxFinger)
            : clamp(FINGER_PER_THICKNESS * t, AUTO_FINGER_MIN, AUTO_FINGER_MAX),
        offset = opt.panelJoint === "offset" ? clamp(opt.panelOffset, t, L.maxOffset) : 0;

    const c: Cut = {
        t,
        kerf,
        growM: kerf / 2 - clearance,
        growF: -kerf / 2,
        finger,
        joint: opt.panelJoint,
        offset
    };

    // How much height the closing plates eat, which is what "inner height"
    // has to be measured against before anything can be laid out.
    const capDepth = c.joint === "edge" ? t : offset + t,
        // Only a finger-jointed top and a clamshell's lid take height out of
        // the inside; a lid that lies on the rim adds to the outside instead.
        topDepth = opt.lid === "finger" || opt.lid === "hinged" ? capDepth : 0;

    const W = clamp(opt.width, L.minSize, L.maxSize) + (opt.dims === "inner" ? 2 * t : 0),
        D = clamp(opt.depth, L.minSize, L.maxSize) + (opt.dims === "inner" ? 2 * t : 0),
        H = clamp(opt.height, L.minSize, L.maxSize) + (opt.dims === "inner" ? capDepth + topDepth : 0);

    const hinge = hingeOf(opt),
        lidH = clamp(opt.lidHeight, 5, Math.max(5, H - 5));

    let aPart: Part[] = [];

    if (opt.lid === "hinged") {
        const baseH = H - lidH;
        if (baseH < capDepth + hinge.mountDrop + hinge.radius + 3) {
            warnings.push(
                `The box under the lid is only ${mm(baseH)} tall, which leaves nowhere to screw the hinge ears on. `
                + "Make the box taller, or the lid shorter."
            );
        }
        if (lidH < t + 2 * hinge.radius + 2) {
            warnings.push(
                `A ${mm(lidH)} lid is too shallow for a ${mm(hinge.radius * 2)} knuckle — the pivot would break out of `
                + `its bottom edge. Give the lid at least ${mm(t + 2 * hinge.radius + 2)}.`
            );
        }
        aPart.push(...buildShell(c, { W, D, H: baseH, bottom: true, top: false, prefix: "", earHoles: hinge }));
        aPart.push(...buildShell(c, { W, D, H: lidH, bottom: false, top: true, prefix: "Lid ", hinge }));

        // The ears, drawn in the side wall's own coordinates — local y = 0 is
        // the rim — so the pivot lands on exactly the point the lid's knuckle
        // reaches: behind the back face and above the rim.
        const aCentre: Point[] = [
            { x: D + hinge.standoff, y: -hinge.rise },
            { x: D - hinge.mount, y: hinge.mountDrop },
            { x: D - hinge.mount - hinge.mountSpacing, y: hinge.mountDrop }
        ];
        const ear = discHull(aCentre, hinge.radius),
            b = ringBounds([ear]);
        for (const sSide of ["left", "right"]) {
            aPart.push({
                label: `Hinge ear (${sSide})`,
                note: `${size(b.x1 - b.x0, b.y1 - b.y0)} — screws to the outside of the ${sSide} wall; `
                    + `the pin through its far hole is what the lid turns on`,
                cut: [
                    ear,
                    ...aCentre.map((p, i) => hole(c, p.x, p.y, hinge.pin, i === 0 ? PIN_PLAY : 0))
                ],
                engrave: []
            });
        }
    } else {
        aPart.push(...buildShell(c, {
            W, D, H,
            bottom: true,
            top: opt.lid === "finger",
            prefix: ""
        }));
    }

    // ── lids that are not part of a shell ───────────────────────────────
    if (opt.lid === "layon") {
        const plate = rectRing({ x0: 0, y0: 0, x1: W, y1: D }, 0),
            lipW = W - 2 * t - 2 * play,
            lipD = D - 2 * t - 2 * play,
            lip = rectRing({ x0: 0, y0: 0, x1: lipW, y1: lipD }, 0);
        aPart.push({
            label: "Lid",
            note: `${size(W, D)} — rests on the rim`
                + (opt.lidLip ? "; the lip's outline is engraved on the underside to glue it against" : ""),
            cut: [plate],
            engrave: opt.lidLip ? [shiftRing(lip, (W - lipW) / 2, (D - lipD) / 2)] : []
        });
        if (opt.lidLip) {
            aPart.push({
                label: "Lid lip",
                note: `${size(lipW, lipD)} — ${mm(play)} smaller than the opening on every side, glued centred under the lid so it cannot slide off`,
                cut: [lip],
                engrave: []
            });
        }
    }

    if (opt.lid === "tray") {
        aPart.push(...buildShell(c, {
            W: W + 2 * t + 2 * play,
            D: D + 2 * t + 2 * play,
            H: lidH,
            bottom: false,
            top: true,
            prefix: "Lid "
        }));
    }

    // ── dividers ────────────────────────────────────────────────────────
    //
    // Two different heights, and confusing them is how a divider ends up
    // holding the lid open: `innerH` is the clear space in the *closed* box —
    // which for a clamshell includes the room in the lid — while `wellH` is how
    // deep the open half is, and that is what a divider stands in.
    const innerW = W - 2 * t,
        innerD = D - 2 * t,
        innerH = H - capDepth - topDepth,
        wellH = (opt.lid === "hinged" ? H - lidH : H) - capDepth - (opt.lid === "finger" ? capDepth : 0),
        nW = Math.round(clamp(opt.dividersW, 0, L.maxDividers)),
        nD = Math.round(clamp(opt.dividersD, 0, L.maxDividers));

    if (nW + nD > 0) {
        const dh = clamp(opt.dividerHeight || wellH, 5, Math.max(5, wellH)),
            slot = Math.max(0.2, t - kerf),
            fit = play,
            aX = Array.from({ length: nW }, (_, i) => t + (innerW * (i + 1)) / (nW + 1)),
            aY = Array.from({ length: nD }, (_, j) => t + (innerD * (j + 1)) / (nD + 1)),
            // Front-to-back dividers are slotted from the top, left-to-right
            // ones from the bottom, so the grid drops together in one motion.
            wW = innerD - 2 * fit,
            wD = innerW - 2 * fit;

        if (dh > wellH + 0.01) warnings.push("The dividers are taller than the box they stand in and would hold the lid open.");

        aX.forEach((x, i) => {
            const ring = slottedPlate(wW, dh, aY.map(y => y - t - fit), [], slot, dh / 2);
            aPart.push({
                label: `Divider ↕ ${i + 1}`,
                note: `${size(wW, dh)} — front to back, ${mm(x)} from the left; slotted from the top`,
                cut: [ring],
                engrave: []
            });
        });
        aY.forEach((y, j) => {
            const ring = slottedPlate(wD, dh, [], aX.map(x => x - t - fit), slot, dh / 2);
            aPart.push({
                label: `Divider ↔ ${j + 1}`,
                note: `${size(wD, dh)} — left to right, ${mm(y)} from the front; slotted from the bottom`,
                cut: [ring],
                engrave: []
            });
        });
    }

    // ── sanity ──────────────────────────────────────────────────────────
    if (finger < 2 * t) {
        warnings.push(
            `Fingers of ${mm(finger)} in ${mm(t)} sheet are shorter than they are deep — they snap off while you `
            + "assemble the box. About three times the thickness is the rule."
        );
    }
    if (innerW <= 0 || innerD <= 0 || innerH <= 0) {
        warnings.push("The walls take up more room than the box has: there is no space left inside it.");
    }
    if (kerf === 0) {
        warnings.push(
            "Kerf is 0, so every joint is cut to nominal size and will come out about a beam's width loose. "
            + "Cut a 20 mm square, measure it, and enter the difference."
        );
    }
    if (clearance > 0.3) {
        warnings.push(`A fit gap of ${mm(clearance)} per side is a loose fit — the box will need glue to stay square.`);
    }

    // ── nest, colour, measure ───────────────────────────────────────────
    const sheet = clamp(opt.sheetWidth, L.minSheet, L.maxSheet),
        gap = clamp(opt.gap, 0, 50),
        { aPlaced, width, height, over } = layOut(aPart, sheet, gap);

    if (over > 0) {
        warnings.push(
            `${over} part${over > 1 ? "s are" : " is"} wider than the ${mm(sheet)} sheet, so the layout has been widened `
            + "to hold them. Cut them from a bigger sheet, or make the box smaller."
        );
    }

    const aCut = aPlaced.flatMap(p => p.cut),
        aMark = aPlaced.flatMap(p => p.engrave),
        aLayer: BoxLayer[] = [
            { operation: CUT, rings: aCut },
            ...(aMark.length ? [{ operation: MARK, rings: aMark }] : [])
        ];

    const body = aLayer.map(l =>
        `<path d="${l.rings.map(a => pathData(a)).join(" ")}" fill="none" stroke="${l.operation.css}"`
        + ` stroke-width="${EXPORT_STROKE}"/>`).join("");

    // Part names are a reading aid on the canvas and are deliberately not in
    // any exported file: nobody wants "Front" burnt into the front.
    const labels = opt.labels
        ? aPlaced.map(p => {
            const fs = Math.max(2.5, Math.min(7, p.w / 8, p.h / 3));
            return `<text x="${r3(p.x + p.w / 2)}" y="${r3(p.y + p.h / 2 + fs * 0.35)}"`
                + ` font-family="system-ui,sans-serif" font-size="${r3(fs)}" fill="#7c8798"`
                + ` text-anchor="middle">${p.label.replace(/[<&]/g, "")}</text>`;
        }).join("")
        : "";

    return {
        preview: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(width)}mm" height="${r3(height)}mm"`
            + ` viewBox="0 0 ${r3(width)} ${r3(height)}">${body}${labels}</svg>`,
        aLayer,
        width,
        height,
        aPart: aPlaced.map(p => ({ label: p.label, note: p.note, width: p.w, height: p.h })),
        outer: { w: W, d: D, h: H },
        inner: { w: innerW, d: innerD, h: Math.max(0, innerH) },
        wellDepth: Math.max(0, wellH),
        pieces: aCut.length,
        points: aCut.reduce((n, a) => n + a.length, 0) + aMark.reduce((n, a) => n + a.length, 0),
        cutLength: aCut.reduce((n, a) => n + ringLength(a), 0),
        finger,
        warnings
    };
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const boxToSvg = (r: BoxResult): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(r.width)}mm" height="${r3(r.height)}mm"`
    + ` viewBox="0 0 ${r3(r.width)} ${r3(r.height)}">`
    + r.aLayer.map(l =>
        `<path d="${l.rings.map(a => pathData(a)).join(" ")}" fill="none" stroke="${l.operation.css}"`
        + ` stroke-width="${EXPORT_STROKE}"/>`).join("")
    + "</svg>";

export const boxToDxf = (r: BoxResult): string => {
    const aEntity: DxfEntity[] = r.aLayer.flatMap(l =>
        l.rings.map(a => ({
            color: l.operation.color,
            closed: true,
            // SVG y grows downward, DXF y grows upward.
            points: a.map(p => ({ x: p.x, y: r.height - p.y }))
        })));
    return buildDxf(aEntity);
};

export const boxToFds = (r: BoxResult): Promise<Blob> =>
    buildFds(r.aLayer.map(l => ({
        mode: l.operation === CUT ? 2 : 1,
        subpaths: l.rings.map(a => ({ points: a, closed: true }))
    })));
