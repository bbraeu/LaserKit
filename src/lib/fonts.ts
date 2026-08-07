// ---------------------------------------------------------------------------
// Which typefaces this machine can actually set text in.
//
// There is no browser API that simply lists them. `queryLocalFonts()` exists in
// Chromium alone and behind a permission prompt, which is a poor trade for a
// tool that should just work — so the families below are *probed* instead, by
// the oldest trick there is: set a string in the candidate family with a known
// fallback behind it, and see whether the measured width moves. If the family
// is missing the browser falls straight through to the fallback and the number
// is unchanged.
//
// Three fallbacks rather than one, because a family that happens to have the
// same metrics as monospace would go undetected against monospace alone.
//
// The alternative to all of this is parsing font files with opentype.js and
// asking the user to supply one. That is offered too — dropping a .ttf/.otf on
// the workspace registers it — but it should not be the price of typing a name
// in a tool whose whole point is that it is quicker than opening Inkscape.
// ---------------------------------------------------------------------------

/** Long enough that a metric difference of one glyph cannot hide. */
const PROBE = "mmmmmmmmmmlliWQ0O@#";
const PROBE_PX = 72;
const FALLBACKS = ["monospace", "sans-serif", "serif"];

/**
 * Families worth probing for, roughly in the order a maker looks for them:
 * the grotesques first, then the ones that actually differ in a laser cut —
 * a slab, a script, a stencil-ish face, something condensed.
 */
const CANDIDATES = [
    "Arial", "Helvetica", "Helvetica Neue", "Inter", "Roboto", "Segoe UI",
    "Verdana", "Tahoma", "Calibri", "Futura", "Century Gothic", "Gill Sans",
    "Franklin Gothic Medium", "Arial Black", "Impact", "Haettenschweiler",
    "Arial Narrow", "Oswald", "Bebas Neue",
    "Times New Roman", "Georgia", "Garamond", "Palatino Linotype", "Book Antiqua",
    "Cambria", "Constantia", "Rockwell", "Bookman Old Style",
    "Courier New", "Consolas", "Lucida Console", "Cascadia Mono", "JetBrains Mono",
    "Brush Script MT", "Comic Sans MS", "Segoe Script", "Lucida Handwriting",
    "Papyrus", "Copperplate Gothic Bold", "Stencil", "Wide Latin"
];

/** Fonts the page can always set, whatever is installed. */
const GENERIC = ["sans-serif", "serif", "monospace", "cursive", "fantasy"];

let measureCtx: CanvasRenderingContext2D | null = null;

const ctx2d = (): CanvasRenderingContext2D | null => {
    if (measureCtx) return measureCtx;
    measureCtx = document.createElement("canvas").getContext("2d");
    return measureCtx;
};

const widthIn = (ctx: CanvasRenderingContext2D, sFamily: string): number => {
    ctx.font = `${PROBE_PX}px ${sFamily}`;
    return ctx.measureText(PROBE).width;
};

/** Quote a family name for a CSS font shorthand, unless it is a generic keyword. */
export const cssFamily = (s: string): string =>
    GENERIC.includes(s) ? s : `"${s.replaceAll('"', '\\"')}"`;

/** Is this family really installed, or would the browser fall back? */
export const hasFont = (sFamily: string): boolean => {
    const ctx = ctx2d();
    if (!ctx) return false;
    if (GENERIC.includes(sFamily)) return true;
    // The CSS Font Loading API knows about anything the page itself registered,
    // which a probe cannot see until it is applied.
    try {
        if (document.fonts.check(`${PROBE_PX}px ${cssFamily(sFamily)}`)) {
            // …but it answers true for *any* name once a fallback would do, so
            // it only settles the question for fonts we added ourselves.
            if ([...document.fonts].some(f => f.family === sFamily)) return true;
        }
    } catch {
        /* no Font Loading API — fall through to the probe */
    }
    return FALLBACKS.some(sBack =>
        widthIn(ctx, `${cssFamily(sFamily)}, ${sBack}`) !== widthIn(ctx, sBack));
};

export interface FontChoice {
    id: string;
    label: string;
    /** registered from a file the user supplied, rather than found on the system */
    loaded?: boolean;
}

/** The generics, then every candidate this machine really has. */
export const availableFonts = (): FontChoice[] => [
    { id: "sans-serif", label: "Sans (system)" },
    { id: "serif", label: "Serif (system)" },
    { id: "monospace", label: "Mono (system)" },
    ...CANDIDATES.filter(hasFont).map(s => ({ id: s, label: s }))
];

/** A file name turned into something worth showing in a picker. */
const familyFromFile = (sName: string): string =>
    sName.replace(/\.(ttf|otf|woff2?|ttc)$/i, "").replace(/[_-]+/g, " ").trim() || "Custom font";

// The `accept` attribute comes from the tool's own `accepts` in lib/tools.ts,
// so it is not repeated here — only the check that a dropped file is one.
export const isFontFile = (file: File): boolean =>
    /\.(ttf|otf|woff2?)$/i.test(file.name);

/**
 * Register a font the user dropped, so the canvas can set text in it.
 *
 * Kept in `document.fonts` rather than parsed: the text is rasterised and
 * traced anyway, so the browser's own shaper — kerning, ligatures and all — is
 * a better glyph source than anything this project would write.
 */
export const loadFontFile = async (file: File): Promise<FontChoice> => {
    const family = familyFromFile(file.name);
    let face: FontFace;
    try {
        face = new FontFace(family, await file.arrayBuffer());
        await face.load();
    } catch {
        throw new Error(`${file.name} is not a font the browser can read — TTF, OTF, WOFF and WOFF2 all work.`);
    }
    document.fonts.add(face);
    return { id: family, label: family, loaded: true };
};
