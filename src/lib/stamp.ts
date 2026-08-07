import { circleRing, pathData, r3, ringBounds, shiftRing } from "./design";
import { OPERATION_COLORS } from "./dxf";
import type { Point } from "./dxf";
import { frameCentre, frameRing, growFrame } from "./invert";
import type { FrameSpec } from "./invert";

// ---------------------------------------------------------------------------
// The parts that turn an engraved stamp face into a stamp you can hold.
//
// The face itself comes off the inverter — rubber, or whatever the plate is
// engraved in. Everything around it is plain sheet material cut to the same
// outline, and it is always the same five ideas:
//
//   · a base plate, the exact size of the stamp's outer contour, that the face
//     is glued onto — with a circle engraved in the middle showing where the
//     handle goes;
//   · five discs that stack into that handle;
//   · a cap lid, a little larger all round;
//   · two rings of the same outer size but a thin wall, which glued under the
//     lid make a cap the stamp slides into.
//
// All of it is derived from the plate's own parameters rather than offset off
// its polygon, so a round stamp gives true circles and a rounded rectangle keeps
// its corner radius — exactly, at any size.
// ---------------------------------------------------------------------------

/** Everything is cut; only the handle position is marked on the base plate. */
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/** Line width of an exported path, in mm. */
const EXPORT_STROKE = 0.3;

/** Handle: five discs of this diameter, glued into a stack you can grip (mm). */
const HANDLE_DIAMETER = 15;
const HANDLE_DISCS = 5;

/** The cap is this much wider than the stamp all round … */
const CAP_GROW = 2;

/** … and its wall is this thick, leaving CAP_GROW − CAP_WALL of play (mm). */
const CAP_WALL = 1;

/** Rings under the lid; each one deepens the cap by one material thickness. */
const CAP_RINGS = 2;

/** Space left between the parts on the sheet, mm. */
const GAP = 5;

/** Parts are laid out in rows no wider than this, unless one part already is (mm). */
const SHEET_WIDTH = 200;

interface Part {
    label: string;
    cut: Point[][];
    engrave: Point[][];
}

export interface StampKit {
    /** the parts nested on one sheet, at true size in millimetres */
    svg: string;
    width: number;
    height: number;
    /** what is in it, for the summary next to the button */
    aPart: { label: string; note: string }[];
    warnings: string[];
}

const moveRings = (aRing: Point[][], dx: number, dy: number): Point[][] =>
    aRing.map(a => shiftRing(a, dx, dy));

/**
 * The parts, each in its own coordinates.
 *
 * `spec` is the stamp's outer contour — the whole plate the inverter drew, not
 * just the artwork on it — so the base plate the face is glued to comes out the
 * same size as the face, edge for edge.
 */
const buildParts = (spec: FrameSpec): Part[] => {
    const base = frameRing(spec),
        c = frameCentre(spec),
        r = HANDLE_DIAMETER / 2,
        // The lid and the rings share one outer contour; the ring's opening is
        // the wall thickness inside it, which is what the stamp slides into.
        outer = frameRing(growFrame(spec, CAP_GROW)),
        inner = frameRing(growFrame(spec, CAP_GROW - CAP_WALL));

    return [
        { label: "Base plate", cut: [base], engrave: [circleRing(c.x, c.y, r)] },
        ...Array.from({ length: HANDLE_DISCS }, (_, i) => ({
            label: `Handle disc ${i + 1}`,
            cut: [circleRing(r, r, r)],
            engrave: []
        })),
        { label: "Cap lid", cut: [outer], engrave: [] },
        ...Array.from({ length: CAP_RINGS }, (_, i) => ({
            label: `Cap ring ${i + 1}`,
            cut: [outer, inner],
            engrave: []
        }))
    ];
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

const mm = (n: number): string => `${Math.round(n * 10) / 10} mm`;

/**
 * The whole kit as one cut-ready SVG in millimetres: cut lines in red, the
 * handle's glue position in line-engraving green.
 */
export const buildStampKit = (spec: FrameSpec): StampKit => {
    const { aPart, width, height } = layOut(buildParts(spec)),
        sCut = aPart.flatMap(p => p.cut).map(a => pathData(a)).join(" "),
        sMark = aPart.flatMap(p => p.engrave).map(a => pathData(a)).join(" ");

    const bPlate = ringBounds([frameRing(spec)]),
        wPlate = bPlate.x1 - bPlate.x0,
        hPlate = bPlate.y1 - bPlate.y0,
        warnings: string[] = [];
    if (Math.min(wPlate, hPlate) < HANDLE_DIAMETER) {
        warnings.push(`The stamp is narrower than the ${HANDLE_DIAMETER} mm handle, so the engraved circle runs off the base plate. Cut the discs down, or glue the stack on as it is — it will simply overhang.`);
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
            { label: "Base plate ×1", note: `${mm(wPlate)} × ${mm(hPlate)} — the stamp's own size, handle circle engraved` },
            { label: `Handle discs ×${HANDLE_DISCS}`, note: `⌀ ${mm(HANDLE_DIAMETER)}, glued into a stack` },
            { label: "Cap lid ×1", note: `${mm(wPlate + 2 * CAP_GROW)} × ${mm(hPlate + 2 * CAP_GROW)} — ${CAP_GROW} mm larger all round` },
            { label: `Cap rings ×${CAP_RINGS}`, note: `same outline, ${CAP_WALL} mm wall — the stamp slides in with ${CAP_GROW - CAP_WALL} mm of play` }
        ],
        warnings
    };
};
