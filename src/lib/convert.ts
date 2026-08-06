import { parsePathToPolylines, getOperationFor, buildDxf, DEFAULT_OPERATION } from "./dxf";
import type { Point, Subpath, DxfEntity, Operation } from "./dxf";
import { buildFds, getFdsModeFor } from "./fds";

const STROKE_WIDTH = 0.6;

// ---------------------------------------------------------------------------
// .xcs data model (the parts of the format this converter relies on)
// ---------------------------------------------------------------------------

interface XcsVec {
    x: number;
    y: number;
}

export interface XcsDisplay {
    id: string;
    type: string;
    x: number;
    y: number;
    angle?: number;
    scale?: XcsVec;
    skew?: XcsVec;
    width: number;
    height: number;
    isFill?: boolean;
    fillRule?: string;
    dPath?: string;
    graphicX?: number;
    graphicY?: number;
    points?: XcsVec[];
    controlPoints?: (XcsVec[] | undefined)[];
    endPoint?: XcsVec;
    charJSONs?: XcsDisplay[];
    style?: { fontFamily?: string; fontSize?: number };
    text?: string;
    /** BITMAP raster as a data URL (v1 stores it inline; xs.ts fills it in for v2) */
    base64?: string;
    /** BITMAP raster location inside a .xs archive — resolved to base64 by xs.ts */
    resourcePath?: string;
}

export interface XcsCanvas {
    id: string;
    title: string;
    displays: XcsDisplay[];
}

/** Laser parameters of one operation. Power is %, speed mm/s, repeat = passes. */
export interface XcsParameters {
    power?: number;
    speed?: number;
    repeat?: number;
    density?: number;
    bitmapMode?: string;
    /** module the values were tuned for: "blue", "ir", … */
    processingLightSource?: string;
    /** newer files name the exact module, e.g. "laser_blue_10W" */
    laser?: string;
    enableOverCut?: boolean;
    overCutDistance?: number;
    enableKerf?: boolean;
    kerfDistance?: number;
}

export interface XcsProcessingConfig {
    /** which parameter set is in effect: "official" (xTool preset) or "customize" */
    materialType?: string;
    planType?: string;
    parameter?: Record<string, XcsParameters>;
}

export interface XcsDeviceDisplayConfig {
    processingType?: string;
    /** parameters per processing type — only the active one is meaningful */
    data?: Record<string, XcsProcessingConfig>;
}

/** Work-area setup of one canvas: material slot, focus and accessory settings. */
export interface XcsModeData {
    /** id in xTool's online material catalogue — 0 when nothing is selected */
    material?: number;
    thickness?: number | null;
    focalLength?: number;
    fanGear?: number;
    purifierGear?: number;
    purifierV3Gear?: number;
    /** names of the fields above that this project actually uses */
    xcsUsed?: string[];
    precautionCodes?: string[];
}

export interface XcsDeviceCanvasEntry {
    mode?: string;
    data?: Record<string, XcsModeData>;
    displays?: { value?: [string, XcsDeviceDisplayConfig][] };
}

/** Material catalogue record — embedded by older app versions only. */
export interface XcsMaterial {
    id: number;
    name?: Record<string, string> | string;
    categoryName?: string;
}

export interface XcsProject {
    canvas: XcsCanvas[];
    /** machine model the project was set up for, e.g. "S1", "D1Pro" */
    extId?: string;
    extName?: string;
    /** version of the app that saved the project */
    version?: string;
    created?: number;
    modify?: number;
    ua?: string;
    /** project thumbnail as a data URL */
    cover?: string;
    device?: {
        /** laser module wattage — a bare number in older files, a list in newer ones */
        power?: number | number[];
        materialList?: XcsMaterial[];
        data?: { value?: [string, XcsDeviceCanvasEntry][] };
    };
}

export interface CanvasSvgResult {
    big: boolean;
    title: string;
    svg: string;
    /** the same drawing with rasters tinted to their operation colour — screen only */
    preview: string;
}

export interface CanvasDxfResult {
    title: string;
    dxf: string;
}

export interface ConvertResult<T> {
    aCanvas: T[];
    aExcluded: string[];
}

// ---------------------------------------------------------------------------
// SVG element builders
// ---------------------------------------------------------------------------

const getTransform = (o: XcsDisplay, bPos = true, bRotate = true, bScale = true): string => {
    let s = "";

    if (bScale && o.scale) {
        s = `scale(${o.scale.x}, ${o.scale.y})`;
    }

    if (o.angle && bRotate) {
        s += ` rotate(${o.angle}, ${o.x}, ${o.y})`;
    }

    if (bPos) {
        s = `translate(${o.x}, ${o.y}) ` + s;
    }

    return s;
};

const getId = (o: XcsDisplay): string => {
    if (import.meta.env.DEV) {
        return `id="${o.id}" `;
    }
    return "";
};

const getFill = (o: XcsDisplay, sColor: string): string => {
    if (o.isFill) {
        // Honour the shape's fill rule so compound paths keep their holes
        // (evenodd); without it the default nonzero rule fills them solid.
        return `fill="${sColor}" fill-rule="${o.fillRule || "nonzero"}"`;
    }
    return `fill="transparent" stroke="${sColor}"`;
};

// Local transform matrix [a,b,c,d] from a display's rotation, skew and scale,
// using the same composition as xTool's editor (PIXI-style). This is what makes
// skew.x === π render as a vertical flip (d = cos(-π)*scaleY = -scaleY);
// ignoring skew would render such shapes upside-down.
const getMatrix = (o: XcsDisplay): [number, number, number, number] => {
    const sx = o.scale?.x ?? 1,
        sy = o.scale?.y ?? 1,
        rot = ((o.angle || 0) * Math.PI) / 180, // angle is stored in degrees
        skX = o.skew?.x || 0,                   // skew is stored in radians
        skY = o.skew?.y || 0;
    return [
        Math.cos(rot + skY) * sx,
        Math.sin(rot + skY) * sx,
        -Math.sin(rot - skX) * sy,
        Math.cos(rot - skX) * sy
    ];
};

// A raster cannot be recoloured the way a stroke can, so in the preview it is
// pushed through a luminance→colour matrix instead: white maps to the operation
// colour, black stays black. The picture stays readable and still reads as
// "yellow = bitmap engraving" like every other shape on the canvas.
const LUMA = [0.2126, 0.7152, 0.0722];

const getTintId = (sColor: string): string => `tint-${sColor.replace("#", "")}`;

const buildTintFilter = (sColor: string): string => {
    // One matrix row per channel: the operation's channel value times the
    // luminance weights, so the image collapses to a ramp of that one colour.
    const row = (i: number): string => {
        const f = parseInt(sColor.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return LUMA.map(w => +(w * f).toFixed(4)).join(" ") + " 0 0";
    };
    return `<filter id="${getTintId(sColor)}" color-interpolation-filters="sRGB">`
        + `<feColorMatrix type="matrix" values="${row(0)} ${row(1)} ${row(2)} 0 0 0 1 0"/></filter>`;
};

type ShapeBuilder = (o: XcsDisplay, sColor: string, bTint?: boolean) => string;

const builders: Record<string, ShapeBuilder> = {
    PATH: (o, sColor) => {
        const [a, b, c, d] = getMatrix(o);
        return `<path ${getId(o)}d="${o.dPath}" ${getFill(o, sColor)} transform="matrix(${a}, ${b}, ${c}, ${d}, ${o.graphicX}, ${o.graphicY})" stroke-width="${STROKE_WIDTH}"/>`;
    },
    RECT: (o, sColor) => {
        return `<rect ${getId(o)}width="${o.width}" height="${o.height}" x="${o.x}" y="${o.y}" ${getFill(o, sColor)} transform="${getTransform(o, false, true, false)}" stroke-width="${STROKE_WIDTH}"/>`;
    },
    CIRCLE: (o, sColor) => {
        return `<ellipse ${getId(o)}rx="${o.width / 2}" ry="${o.height / 2}" transform="${getTransform(o, false, true, false)} translate(${o.x + o.width / 2}, ${o.y + o.height / 2})" ${getFill(o, sColor)} stroke-width="${STROKE_WIDTH}"/>`;
    },
    POLYGON: (o, sColor) => {
        return `<polygon ${getId(o)}points="${o.points}" ${getFill(o, sColor)} transform="${getTransform(o)}" stroke-width="${STROKE_WIDTH}"/>`;
    },
    LINE: (o, sColor) => {
        return `<line ${getId(o)}x1="${o.x}" y1="${o.y}" x2="${o.x + (o.endPoint?.x ?? 0)}" y2="${o.y + (o.endPoint?.y ?? 0)}" stroke="${sColor}" transform="${getTransform(o, false)}" stroke-width="${STROKE_WIDTH}"/>`;
    },
    TEXT: (o, sColor) => {
        if (o.charJSONs) {
            return o.charJSONs
                .map(c => {
                    c.x = c.graphicX ?? c.x;
                    c.y = c.graphicY ?? c.y;
                    return builders.PATH!(c, sColor);
                })
                .join("");
        }
        // This mode would rather be only for generated files
        const aStyle: string[] = [],
            oStyle = o.style || {};

        if (oStyle.fontFamily) {
            aStyle.push(`font-family: ${oStyle.fontFamily}`);
        }
        if (oStyle.fontSize) { // 0.2818 is a magic number which seems to bring the scale just right
            aStyle.push(`font-size: ${oStyle.fontSize * 0.2818}pt`);
        }
        return `<text ${getId(o)}transform="${getTransform(o, false)}" dominant-baseline="mathematical" x="${o.x}" y="${o.y}" style="${aStyle.join(";")}">${o.text}</text>`;
    },
    PEN: (o, sColor) => {
        const a: string[] = [],
            points = o.points || [],
            controlPoints = o.controlPoints || [];

        points.forEach((c, i) => {
            if (i === 0) {
                a.push(`M ${c.x} ${c.y}`);
                return;
            }
            const aCp = controlPoints[i];
            if (aCp) {
                a.push(`S ${aCp[0]!.x} ${aCp[0]!.y} ${c.x} ${c.y}`);
            } else {
                const aPrev = controlPoints[i - 1];
                if (aPrev) {
                    a.push(`Q ${aPrev[1]!.x} ${aPrev[1]!.y} ${c.x} ${c.y}`);
                } else {
                    a.push(`L ${c.x} ${c.y}`);
                }
            }
        });

        const oLast = controlPoints[points.length - 1];
        if (oLast && points[0]) {
            a.push(`Q ${oLast[1]!.x} ${oLast[1]!.y} ${points[0].x} ${points[0].y}`);
        }

        return `<path ${getId(o)}d="${a.join(" ")}" ${getFill(o, sColor)} transform="${getTransform(o, false)}" stroke-width="${STROKE_WIDTH}"/>`;
    },
    // width/height are already the placed size in mm (originWidth * scale), so the
    // raster is stretched to that box — preserveAspectRatio="none" keeps it filling
    // the box even when the user scaled it non-uniformly. Omit href when the raster
    // is missing so the box still contributes geometry instead of a broken image.
    BITMAP: (o, sColor, bTint) => {
        const sHref = o.base64 ? `href="${o.base64}" ` : "",
            // Only ever set for the preview: the filter lives in that SVG's
            // <defs>, and referencing a filter that is not there stops the
            // element from rendering at all. The exported SVG keeps the original
            // pixels — a tinted photo would engrave differently, since laser
            // software maps the image's luminance to laser power.
            sFilter = bTint ? `filter="url(#${getTintId(sColor)})" ` : "";
        return `<image ${getId(o)}${sHref}${sFilter}x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" preserveAspectRatio="none" transform="${getTransform(o, false, true, false)}" />`;
    }
};

// ---------------------------------------------------------------------------
// Canvas processing
// ---------------------------------------------------------------------------

export const getDeviceEntry = (oJSON: XcsProject, sCanvasId: string): XcsDeviceCanvasEntry | undefined =>
    oJSON.device?.data?.value?.find(a => a[0] === sCanvasId)?.[1];

// Build displayId -> processingType map for a canvas. The operation type
// (surface engraving / line engraving / line cutting) is not stored on the
// geometry — it lives in device.data.value, a serialised Map:
//   [canvasId, { displays: Map<displayId, { processingType, ... }> }]
const getProcessingTypeMap = (oJSON: XcsProject, oCanvas: XcsCanvas): Map<string, string | undefined> => {
    const map = new Map<string, string | undefined>(),
        aDisplays = getDeviceEntry(oJSON, oCanvas.id)?.displays?.value;

    if (Array.isArray(aDisplays)) {
        aDisplays.forEach(([sId, oCfg]) => map.set(sId, oCfg?.processingType));
    }
    return map;
};

const isBigCanvas = (oJSON: XcsProject, oCanvas: XcsCanvas): boolean =>
    getDeviceEntry(oJSON, oCanvas.id)?.mode === "SUPER_LASER_PLANE";

/** Distinct operations used by a canvas — for the preview colour legend. */
export const getUsedOperations = (oJSON: XcsProject, oCanvas: XcsCanvas): Operation[] => {
    const seen = new Set<string>();
    getProcessingTypeMap(oJSON, oCanvas).forEach(pt => { if (pt) seen.add(pt); });
    return [...seen].map(pt => getOperationFor(pt));
};

const processCanvas = (oJSON: XcsProject, oCanvas: XcsCanvas, aExcluded: string[]): CanvasSvgResult => {
    const aOutput: string[] = [],
        aPreview: string[] = [],
        aTints = new Set<string>(),
        oPTMap = getProcessingTypeMap(oJSON, oCanvas),
        bBig = isBigCanvas(oJSON, oCanvas);

    // Colour each display by its operation type so the preview shows surface
    // engraving / line engraving / cutting the same way the DXF does.
    oCanvas.displays.forEach(oDisplay => {
        const fnConvert = builders[oDisplay.type];
        if (!fnConvert) {
            aExcluded.push(oDisplay.type);
            return;
        }
        const oOperation = getOperationFor(oPTMap.get(oDisplay.id)),
            sShape = fnConvert(oDisplay, oOperation.css);

        aOutput.push(sShape);
        // Tint rasters on screen only — and never with the "Other" fallback,
        // which is black and would leave the image invisible.
        if (oDisplay.type === "BITMAP" && oOperation !== DEFAULT_OPERATION) {
            aTints.add(oOperation.css);
            aPreview.push(fnConvert(oDisplay, oOperation.css, true));
        } else {
            aPreview.push(sShape);
        }
    });

    const iHeight = bBig ? 930 : 390,
        sViewBox = `viewBox="0 0 430 ${iHeight}" xmlns="http://www.w3.org/2000/svg"`,
        sDefs = aTints.size ? `<defs>${[...aTints].map(buildTintFilter).join("")}</defs>` : "";

    return {
        big: bBig,
        title: oCanvas.title.replace("{panel}", "Canvas "),
        // The export states its physical size: an SVG carrying only a viewBox has
        // no real-world scale, so importers fall back to 96 dpi on the user units
        // and the design arrives 25.4/96 = 3.78× too small. With width/height in
        // millimetres one user unit is one millimetre, as the xcs coordinates are.
        svg: `<svg width="430mm" height="${iHeight}mm" ${sViewBox}>${aOutput.join("")}</svg>`,
        // On screen the box comes from the container instead, so the preview is
        // left unsized — and it is the only variant carrying the raster tints.
        preview: `<svg ${sViewBox}>${sDefs}${aPreview.join("")}</svg>`
    };
};

export const toSVG = (oJSON: XcsProject): ConvertResult<CanvasSvgResult> => {
    const aExcluded: string[] = [];
    return {
        aCanvas: oJSON.canvas.map(c => processCanvas(oJSON, c, aExcluded)),
        aExcluded
    };
};

// ---------------------------------------------------------------------------
// DXF conversion
//
// To avoid re-deriving every shape transform, we reuse the SVG builders above:
// each shape is rendered into an off-screen <svg>, then we read the browser's
// getCTM() to map local coordinates into the canvas (mm) coordinate system, and
// flatten curves to polylines. Requires a DOM — browser only.
// ---------------------------------------------------------------------------

// Extract local (pre-transform) polylines from a rendered SVG geometry element.
// Also used by the outline tracer on arbitrary SVG files, hence the shape types
// an .xcs canvas never produces (circle, polyline).
export const getLocalGeometry = (el: SVGGraphicsElement): Subpath[] => {
    const f = (a: string): number => parseFloat(el.getAttribute(a) || "") || 0,
        tag = el.tagName.toLowerCase();

    switch (tag) {
        case "path":
            return parsePathToPolylines(el.getAttribute("d"));
        case "rect":
        case "image": { // <image> becomes a bounding rectangle (raster can't be vectorised)
            const x = f("x"), y = f("y"), w = f("width"), h = f("height");
            return [{ points: [
                { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
            ], closed: true }];
        }
        case "ellipse":
        case "circle": {
            const r = f("r"),
                rx = f("rx") || r, ry = f("ry") || r,
                cx = f("cx"), cy = f("cy"),
                rMax = Math.max(rx, ry),
                segs = Math.max(12, Math.ceil((2 * Math.PI) / (2 * Math.acos(Math.max(0, 1 - 0.01 / rMax))))),
                pts: Point[] = [];
            for (let i = 0; i < segs; i++) {
                const t = (2 * Math.PI * i) / segs;
                pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
            }
            return [{ points: pts, closed: true }];
        }
        case "line":
            return [{ points: [
                { x: f("x1"), y: f("y1") }, { x: f("x2"), y: f("y2") }
            ], closed: false }];
        case "polygon":
        case "polyline": {
            const pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number),
                out: Point[] = [];
            for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i]!, y: pts[i + 1]! });
            return out.length ? [{ points: out, closed: tag === "polygon" }] : [];
        }
        default:
            return [];
    }
};

interface DisplayGeometry {
    processingType: string | undefined;
    /** subpaths in canvas coordinates (mm, y grows downwards) */
    subpaths: Subpath[];
}

// Render every display into a single off-screen SVG (one <g data-idx> per
// display, so each rendered element maps back to its processingType) and read
// the geometry back in canvas (mm) coordinates via getCTM().
const extractCanvasGeometry = (oJSON: XcsProject, oCanvas: XcsCanvas, aExcluded: string[]): DisplayGeometry[] => {
    const oPTMap = getProcessingTypeMap(oJSON, oCanvas),
        H = isBigCanvas(oJSON, oCanvas) ? 930 : 390;

    const aParts: string[] = [];
    oCanvas.displays.forEach((oDisplay, i) => {
        const fnConvert = builders[oDisplay.type];
        if (fnConvert) {
            aParts.push(`<g data-idx="${i}">${fnConvert(oDisplay, "black")}</g>`);
        } else {
            aExcluded.push(oDisplay.type);
        }
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 430 ${H}`);
    svg.setAttribute("width", "430");
    svg.setAttribute("height", String(H));
    svg.style.cssText = "position:absolute;left:-100000px;top:0;opacity:0;pointer-events:none";
    svg.innerHTML = aParts.join("");
    document.body.appendChild(svg);

    const aResult: DisplayGeometry[] = [];
    try {
        svg.querySelectorAll<SVGGElement>("g[data-idx]").forEach(gEl => {
            const iIdx = parseInt(gEl.getAttribute("data-idx")!, 10),
                oDisplay = oCanvas.displays[iIdx]!,
                oGeo: DisplayGeometry = { processingType: oPTMap.get(oDisplay.id), subpaths: [] };

            gEl.querySelectorAll<SVGGraphicsElement>("path,rect,ellipse,line,polygon,image").forEach(el => {
                const m = el.getCTM();
                if (!m) return;
                getLocalGeometry(el).forEach(sub => {
                    if (sub.points.length < 2) return;
                    oGeo.subpaths.push({
                        closed: sub.closed,
                        // Map local coords into canvas (mm) space via the element's CTM.
                        points: sub.points.map(p => ({
                            x: m.a * p.x + m.c * p.y + m.e,
                            y: m.b * p.x + m.d * p.y + m.f
                        }))
                    });
                });
            });

            if (oGeo.subpaths.length) aResult.push(oGeo);
        });
    } finally {
        document.body.removeChild(svg);
    }

    return aResult;
};

/**
 * Every subpath of a canvas in millimetres, operation types dropped — what the
 * outline tracer needs to find the contour around a design.
 */
export const getCanvasGeometry = (oJSON: XcsProject, oCanvas: XcsCanvas): Subpath[] =>
    extractCanvasGeometry(oJSON, oCanvas, []).flatMap(o => o.subpaths);

const processCanvasDXF = (oJSON: XcsProject, oCanvas: XcsCanvas, aExcluded: string[]): CanvasDxfResult => {
    const aEntities: DxfEntity[] = extractCanvasGeometry(oJSON, oCanvas, aExcluded).flatMap(oGeo => {
        const iColor = getOperationFor(oGeo.processingType).color;
        return oGeo.subpaths.map(sub => ({ color: iColor, closed: sub.closed, points: sub.points }));
    });

    // SVG y grows downward, DXF y grows upward: flip about the bounding box top.
    let maxY = -Infinity;
    aEntities.forEach(e => e.points.forEach(p => { if (p.y > maxY) maxY = p.y; }));
    if (isFinite(maxY)) {
        aEntities.forEach(e => e.points.forEach(p => { p.y = maxY - p.y; }));
    }

    return {
        title: oCanvas.title.replace("{panel}", "Canvas "),
        dxf: buildDxf(aEntities)
    };
};

export const toDXF = (oJSON: XcsProject): ConvertResult<CanvasDxfResult> => {
    const aExcluded: string[] = [];
    return {
        aCanvas: oJSON.canvas.map(c => processCanvasDXF(oJSON, c, aExcluded)),
        aExcluded
    };
};

export interface CanvasFdsResult {
    title: string;
    fds: Blob;
}

// Falcon Design Space projects keep the operation type per layer natively —
// unlike DXF, no manual re-assignment is needed after import. Geometry is
// grouped per display so compound paths keep their holes in fill mode.
export const toFDS = async (oJSON: XcsProject): Promise<ConvertResult<CanvasFdsResult>> => {
    const aExcluded: string[] = [];
    const aCanvas = await Promise.all(oJSON.canvas.map(async oCanvas => ({
        title: oCanvas.title.replace("{panel}", "Canvas "),
        fds: await buildFds(
            extractCanvasGeometry(oJSON, oCanvas, aExcluded).map(oGeo => ({
                mode: getFdsModeFor(oGeo.processingType),
                subpaths: oGeo.subpaths
            }))
        )
    })));
    return { aCanvas, aExcluded };
};
