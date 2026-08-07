import type { ExportItem } from "./types";

// ---------------------------------------------------------------------------
// The three files this kit writes, described once.
//
// Every tool used to carry its own copy of these labels and one-liners inside
// its download menu, so a wording fix meant four edits and the converter's
// description of a DXF had already drifted from the tracer's. There is one
// description of a DXF now, and one builder of the menu rows around it.
// ---------------------------------------------------------------------------

export const FORMATS = {
    dxf: {
        ext: "dxf",
        label: "DXF",
        note: "universal",
        desc: "CAD/CAM format — operations colour-coded, read by every laser and CAM tool",
        mime: "application/dxf"
    },
    fds: {
        ext: "fds",
        label: "FDS",
        note: "Falcon Design Space",
        desc: "Native FDS project — engrave & cut layers already assigned on import",
        mime: "application/octet-stream"
    },
    svg: {
        ext: "svg",
        label: "SVG",
        note: "vector",
        desc: "Colour-coded vector graphic — images keep their original pixels",
        mime: "image/svg+xml"
    }
} as const;

export type FormatKey = keyof typeof FORMATS;

export const FORMAT_KEYS = Object.keys(FORMATS) as FormatKey[];

/**
 * Of the three outputs only SVG can hold a raster image: DXF's only raster
 * entity is a reference to an external file, and an .fds shape is a QPainterPath
 * outline. So a design containing an image is offered as SVG only, rather than
 * handing out a DXF/FDS with the picture silently missing.
 */
export const carriesRaster = (fmt: FormatKey): boolean => fmt === "svg";

export interface DesignExportSpec {
    /** file name without the extension */
    stem: string;
    /**
     * GA event name prefix: "INVERT" gives INVERT_SVG_Download. Empty for the
     * converter, whose events were configured as the bare DXF_Download and
     * friends before the kit had more than one tool.
     */
    eventPrefix: string;
    /** the design in each format, built only when the row is picked */
    build: (fmt: FormatKey) => Blob | Promise<Blob>;
    /** why a format cannot be used here; undefined = it can */
    blocked?: (fmt: FormatKey) => string | undefined;
    /** the order they appear in, first being the default; SVG first by default */
    order?: FormatKey[];
}

/** The "the design as …" group of the export menu. */
export const designExports = (o: DesignExportSpec): ExportItem[] =>
    (o.order ?? ["svg", "dxf", "fds"]).map(fmt => ({
        id: fmt,
        label: FORMATS[fmt].label,
        note: FORMATS[fmt].note,
        desc: FORMATS[fmt].desc,
        filename: `${o.stem}.${FORMATS[fmt].ext}`,
        blob: () => o.build(fmt),
        // Event names as configured in Google Analytics: INVERT_DXF_Download, …
        event: `${o.eventPrefix ? `${o.eventPrefix}_` : ""}${fmt.toUpperCase()}_Download`,
        blocked: o.blocked?.(fmt),
        group: "design" as const
    }));

export const textBlob = (s: string, fmt: FormatKey): Blob => new Blob([s], { type: FORMATS[fmt].mime });
