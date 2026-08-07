import { circleRing, pathData, r3, rectRing, ringBounds, shiftRing } from "./design";
import type { Box } from "./design";
import { OPERATION_COLORS } from "./dxf";
import type { Point } from "./dxf";
import { frameCentre, frameRing } from "./invert";
import type { FrameSpec } from "./invert";

// ---------------------------------------------------------------------------
// The parts that turn an engraved stamp face into a stamp you can hold.
//
// The face itself comes off the inverter — rubber, or whatever the plate is
// engraved in. Everything here is plain sheet material cut flat and glued into
// a stack, which is the only thing a laser can make a three-dimensional grip
// out of: layers.
//
// That is why the *sheet thickness* decides the parts list rather than a fixed
// count. A grip wants to be about 20 mm tall to press on; in 3 mm plywood that
// is seven layers and in 6 mm acrylic it is three. Starting from a number the
// tool can work out is how you avoid a 45 mm handle by accident.
//
// Every one of those numbers is then yours to change — layers, diameter, bar
// length, upright height. They arrive as 0 meaning "whatever you worked out",
// which is what keeps the defaults following the sheet right up until somebody
// disagrees with one of them.
//
// Four grips, all buildable from one sheet:
//
//   · discs — a plain stack of ⌀ 15 mm circles, the quickest thing to glue;
//   · knob  — the same stack with the diameters graded, so it domes into
//             something that fits the pad of a thumb;
//   · bar   — a rounded bar across the back, the shape a traditional office
//             stamp has, for a plate too long to press evenly from one point;
//   · arch  — two uprights glued on edge with a grip bar across them, so your
//             fingers go *under* the handle. The tallest, and the only one whose
//             height is its own rather than a multiple of the sheet.
// ---------------------------------------------------------------------------

/** Everything is cut; only the glue positions are marked on the base plate. */
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

/** Space left between the parts on the sheet, mm. */
const GAP = 5;

/** Parts are laid out in rows no wider than this, unless one part already is (mm). */
const SHEET_WIDTH = 200;

/** How tall a glued grip aims to be, before anyone says otherwise. */
const GRIP_HEIGHT = 20;

/** Plain stack: one diameter, however many layers the sheet needs. */
const DISC_DIAMETER = 15;

/** Graded stack: the top disc is this share of the base one. */
const KNOB_BASE = 22;
const KNOB_TAPER = 12 / 22;

/** Bar grip: this deep, and as long as the stamp can carry. */
const BAR_DEPTH = 18;
const BAR_MIN_LENGTH = 30;
const BAR_MAX_LENGTH = 90;

/** Arch: two uprights this wide, standing on edge. */
const UPRIGHT_WIDTH = 14;
const UPRIGHT_HEIGHT = 25;

/**
 * What the handle controls may be set to. Exported so the inspector's sliders
 * and this file's clamps are one set of numbers rather than two that drift.
 */
export const GRIP = {
    minLayers: 2,
    maxLayers: 14,
    minSize: 8,
    maxSize: 120,
    minHeight: 12,
    maxHeight: 60,
    barDepth: BAR_DEPTH,
    uprightWidth: UPRIGHT_WIDTH
} as const;

export type HandleType = "discs" | "knob" | "bar" | "arch" | "none";

export const HANDLES: { id: HandleType; label: string; hint: string }[] = [
    {
        id: "discs",
        label: "Discs",
        hint: `A stack of ⌀ ${DISC_DIAMETER} mm circles glued into a knob — the quickest handle to cut and the easiest to glue straight.`
    },
    {
        id: "knob",
        label: "Knob",
        hint: `The same stack with the diameters graded down to ${Math.round(KNOB_TAPER * 100)} % of the base, so it domes into something that fits under a thumb.`
    },
    {
        id: "bar",
        label: "Bar",
        hint: "A rounded bar across the back, the shape an office stamp has. For a long plate, which a single knob presses unevenly."
    },
    {
        id: "arch",
        label: "Arch",
        hint: "Two uprights glued on edge with a grip bar across them, so your fingers go under the handle. Its height is the upright’s own, so a thin sheet does not make a short handle."
    },
    {
        id: "none",
        label: "None",
        hint: "Just the base plate — for a stamp that goes into a mount you already have."
    }
];

export interface StampKitOptions {
    handle: HandleType;
    /** sheet thickness in mm; decides how many layers a target height takes */
    thickness: number;
    /** layers in a glued stack; 0 = enough of this sheet for a 20 mm grip */
    layers?: number;
    /** disc or knob diameter, or bar length; 0 = the handle type's own default */
    size?: number;
    /** the arch's upright height in mm; 0 = 25 */
    height?: number;
}

export interface StampKit {
    /** the parts nested on one sheet, at true size in millimetres */
    svg: string;
    width: number;
    height: number;
    /** what is in it, for the summary beside the button */
    aPart: { label: string; note: string }[];
    /** how tall the assembled handle stands, mm */
    handleHeight: number;
    /** layers in the glued stack, 0 for the arch and for no handle */
    layers: number;
    warnings: string[];
}

interface Part {
    label: string;
    cut: Point[][];
    engrave: Point[][];
}

const moveRings = (aRing: Point[][], dx: number, dy: number): Point[][] =>
    aRing.map(a => shiftRing(a, dx, dy));

const mm = (n: number): string => `${Math.round(n * 10) / 10} mm`;

/** A box of this size with its top-left at the origin. */
const boxAt = (w: number, h: number): Box => ({ x0: 0, y0: 0, x1: w, y1: h });

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Layers of `thickness` that come nearest to a grip you can hold. */
export const autoLayers = (thickness: number): number =>
    clamp(Math.round(GRIP_HEIGHT / Math.max(0.5, thickness)), GRIP.minLayers, GRIP.maxLayers);

/** The across-dimension a handle takes when nobody has named one. */
export const autoSize = (handle: HandleType, plateWidth: number): number => {
    switch (handle) {
        case "discs": return DISC_DIAMETER;
        case "knob": return KNOB_BASE;
        case "bar":
        case "arch":
            return Math.round(clamp(plateWidth * 0.7, BAR_MIN_LENGTH, BAR_MAX_LENGTH) * 10) / 10;
        default: return 0;
    }
};

/** The arch's upright height when nobody has named one. */
export const AUTO_ARCH_HEIGHT = UPRIGHT_HEIGHT;

interface Handle {
    parts: Part[];
    /** where the handle glues, engraved on the base plate (plate coordinates) */
    mark: Point[][];
    /** assembled height, mm */
    height: number;
    layers: number;
    /** the footprint that has to fit on the plate */
    footprint: { w: number; h: number };
    aNote: { label: string; note: string }[];
}

/**
 * The grip, in its own coordinates, plus the mark that says where it goes.
 *
 * `plate` is the stamp's own size, which the bar and the arch scale themselves
 * to — a 90 mm bar on a 40 mm stamp would overhang at both ends.
 */
const buildHandle = (o: StampKitOptions, plate: { w: number; h: number }, centre: Point): Handle => {
    if (o.handle === "none") {
        return { parts: [], mark: [], height: 0, layers: 0, footprint: { w: 0, h: 0 }, aNote: [] };
    }

    const n = clamp(o.layers || autoLayers(o.thickness), GRIP.minLayers, GRIP.maxLayers),
        height = n * o.thickness,
        size = clamp(o.size || autoSize(o.handle, plate.w), GRIP.minSize, GRIP.maxSize);

    if (o.handle === "discs" || o.handle === "knob") {
        const bKnob = o.handle === "knob",
            dTop = size * KNOB_TAPER,
            // Graded from the base up; a plain stack is the same figure twice.
            diameterAt = (i: number): number => bKnob
                ? size + ((dTop - size) * i) / Math.max(1, n - 1)
                : size;

        return {
            parts: Array.from({ length: n }, (_, i) => {
                const r = diameterAt(i) / 2;
                return { label: `Layer ${i + 1}`, cut: [circleRing(r, r, r)], engrave: [] };
            }),
            mark: [circleRing(centre.x, centre.y, size / 2)],
            height,
            layers: n,
            footprint: { w: size, h: size },
            aNote: [{
                label: `${bKnob ? "Knob" : "Handle"} layers ×${n}`,
                note: bKnob
                    ? `⌀ ${mm(size)} down to ⌀ ${mm(dTop)}, glued largest first — ${mm(height)} of grip`
                    : `⌀ ${mm(size)}, glued into a stack — ${mm(height)} of grip`
            }]
        };
    }

    // Both remaining grips are a bar; the arch just stands it on two legs.
    const barLen = size,
        barRing = (): Point[] => rectRing(boxAt(barLen, BAR_DEPTH), BAR_DEPTH / 2);

    if (o.handle === "bar") {
        return {
            parts: Array.from({ length: n }, (_, i) => ({
                label: `Bar ${i + 1}`, cut: [barRing()], engrave: []
            })),
            mark: [shiftRing(barRing(), centre.x - barLen / 2, centre.y - BAR_DEPTH / 2)],
            height,
            layers: n,
            footprint: { w: barLen, h: BAR_DEPTH },
            aNote: [{
                label: `Bar layers ×${n}`,
                note: `${mm(barLen)} × ${mm(BAR_DEPTH)}, glued into a stack — ${mm(height)} of grip`
            }]
        };
    }

    // Arch: two uprights on edge, a bar glued across their tops. Its height is
    // the upright's own, so a thin sheet does not make a short handle.
    const archH = clamp(o.height || UPRIGHT_HEIGHT, GRIP.minHeight, GRIP.maxHeight),
        upright = (): Point[] => rectRing(boxAt(UPRIGHT_WIDTH, archH), 3),
        // The uprights stand at the ends of the bar, one thickness in from each.
        dx = barLen / 2 - o.thickness / 2,
        legMark = (side: number): Point[] => rectRing({
            x0: centre.x + side * dx - o.thickness / 2,
            y0: centre.y - UPRIGHT_WIDTH / 2,
            x1: centre.x + side * dx + o.thickness / 2,
            y1: centre.y + UPRIGHT_WIDTH / 2
        }, 0);

    return {
        parts: [
            { label: "Upright 1", cut: [upright()], engrave: [] },
            { label: "Upright 2", cut: [upright()], engrave: [] },
            { label: "Grip bar", cut: [barRing()], engrave: [] }
        ],
        mark: [legMark(-1), legMark(1)],
        height: archH + o.thickness,
        layers: 0,
        footprint: { w: barLen, h: UPRIGHT_WIDTH },
        aNote: [
            {
                label: "Uprights ×2",
                note: `${mm(UPRIGHT_WIDTH)} × ${mm(archH)}, glued on edge along the marks`
            },
            {
                label: "Grip bar ×1",
                note: `${mm(barLen)} × ${mm(BAR_DEPTH)}, across their tops — ${mm(archH + o.thickness)} of clearance`
            }
        ]
    };
};

/** Shelf packing, in the order the parts were built: rows across, then down. */
const layOut = (aPart: Part[]): { aPart: Part[]; width: number; height: number } => {
    const aBox = aPart.map(p => ringBounds([...p.cut, ...p.engrave])),
        wMax = Math.max(SHEET_WIDTH, ...aBox.map(b => b.x1 - b.x0));

    let x = 0,
        y = 0,
        hRow = 0,
        wUsed = 0;
    const aOut = aPart.map((p, i) => {
        const b = aBox[i]!,
            w = b.x1 - b.x0,
            h = b.y1 - b.y0;
        if (x > 0 && x + w > wMax) {
            x = 0;
            y += hRow + GAP;
            hRow = 0;
        }
        const out: Part = {
            label: p.label,
            cut: moveRings(p.cut, x - b.x0, y - b.y0),
            engrave: moveRings(p.engrave, x - b.x0, y - b.y0)
        };
        x += w + GAP;
        hRow = Math.max(hRow, h);
        wUsed = Math.max(wUsed, x - GAP);
        return out;
    });

    return { aPart: aOut, width: wUsed, height: y + hRow };
};

/**
 * The whole kit as one cut-ready SVG in millimetres: cut lines in red, the
 * handle's glue positions in line-engraving green.
 */
export const buildStampKit = (spec: FrameSpec, o: StampKitOptions): StampKit => {
    const plateRing = frameRing(spec),
        b = ringBounds([plateRing]),
        plate = { w: b.x1 - b.x0, h: b.y1 - b.y0 },
        handle = buildHandle(o, plate, frameCentre(spec));

    const base: Part = { label: "Base plate", cut: [plateRing], engrave: handle.mark },
        { aPart, width, height } = layOut([base, ...handle.parts]),
        sCut = aPart.flatMap(p => p.cut).map(a => pathData(a)).join(" "),
        sMark = aPart.flatMap(p => p.engrave).map(a => pathData(a)).join(" ");

    const warnings: string[] = [];
    if (handle.footprint.w > plate.w || handle.footprint.h > plate.h) {
        warnings.push(
            `The ${o.handle} handle is ${mm(handle.footprint.w)} × ${mm(handle.footprint.h)}, which does not fit on a `
            + `${mm(plate.w)} × ${mm(plate.h)} stamp — the glue marks run off the base plate. Pick a smaller handle, `
            + "or glue it on overhanging."
        );
    }

    return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(width)}mm" height="${r3(height)}mm"`
            + ` viewBox="0 0 ${r3(width)} ${r3(height)}">`
            + `<path d="${sCut}" fill="none" stroke="${CUT.css}" stroke-width="${EXPORT_STROKE}"/>`
            + `<path d="${sMark}" fill="none" stroke="${MARK.css}" stroke-width="${EXPORT_STROKE}"/>`
            + "</svg>",
        width,
        height,
        aPart: [
            {
                label: "Base plate ×1",
                note: `${mm(plate.w)} × ${mm(plate.h)} — the stamp's own size, with the handle's glue position engraved`
            },
            ...handle.aNote
        ],
        handleHeight: handle.height,
        layers: handle.layers,
        warnings
    };
};
