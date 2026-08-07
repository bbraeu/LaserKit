// ---------------------------------------------------------------------------
// The kit's tools, in one place.
//
// Every tool is a page of its own, so each gets the title, description and
// explainer copy that its own search traffic arrives for. This list is what the
// header menu, the landing page's launcher and each tool page's switcher are all
// built from — adding a tool means adding an entry here and a page that names it.
// ---------------------------------------------------------------------------

export interface ToolDef {
    id: string;
    /** path under the site base; "" is the landing page */
    slug: string;
    /** full name, as the tool page's heading */
    label: string;
    /** short name for the header menu and the switcher chips */
    short: string;
    /** what goes in and what comes out */
    hint: string;
    /** one line on the launcher card */
    blurb: string;
    /** heroicons-style outline path, drawn stroked */
    icon: string;
    /** an extra path drawn *filled* on top — the only way to glyph "half of this is solid" */
    iconFill?: string;
    /** file types the tool accepts, for the copy (the input element has its own) */
    accepts: string;
    /** <title> and meta description of the tool's page */
    title: string;
    description: string;
}

export const TOOLS: ToolDef[] = [
    {
        id: "convert",
        slug: "convert/",
        label: "xTool project converter",
        short: "Converter",
        hint: ".xcs / .xs → DXF · FDS · SVG",
        blurb: "Open an xTool Creative Space or xTool Studio project in any laser software, with surface engraving, line engraving and cutting kept apart.",
        icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z",
        accepts: ".xcs, .xs",
        title: "xTool .xcs / .xs converter — to DXF, Falcon Design Space & SVG | LaserKit",
        description: "Free converter for xTool Creative Space (.xcs) and xTool Studio (.xs) project files to DXF, native Falcon Design Space projects (.fds) and SVG. Keeps surface engraving, line engraving and cutting separated. 100% in-browser."
    },
    {
        id: "contour",
        slug: "contour/",
        label: "Outer contour tracer",
        short: "Outer contour",
        hint: ".svg / .xcs / .xs → cut line",
        blurb: "Trace the cut line around a design — for the backing plate you glue the original on top of. Border, item picking and three ways to join items into one plate.",
        icon: "M15 8.25H9m6 3H9m3 6-3-3h1.5a3 3 0 1 0 0-6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
        accepts: ".svg, .xcs, .xs",
        title: "Trace the outer contour of a design into a cut line | LaserKit",
        description: "Free in-browser tool that traces the outer contour of an SVG or xTool project into a single closed cut line — with an adjustable border, per-item picking and shrink-wrap, bridges or a taut band to join items into one backing plate."
    },
    {
        id: "trace",
        slug: "trace/",
        label: "Trace an image",
        short: "Trace",
        hint: "png / jpg → vectors",
        blurb: "Turn a photo, scan or logo into real vector paths — outlines to engrave or cut, or one line down the middle of every stroke, with every slider live.",
        icon: "M4.5 4.5h15v15h-15zM7.5 16.5c1.5-4.5 3-6.75 4.5-6.75s3 2.25 4.5 6.75",
        accepts: ".png, .jpg, .gif, .bmp, .webp",
        title: "Trace an image to SVG — bitmap to vector for lasers | LaserKit",
        description: "Free in-browser image tracer: turn a PNG, JPEG or scan into vector paths with live threshold, smooth and optimize sliders. Outline or centreline, exported as SVG, DXF or Falcon Design Space."
    },
    {
        // Renamed to the job it does. /invert/ is still a page — a redirect to
        // here — so links from before the rename keep working.
        id: "stamp",
        slug: "stamp/",
        label: "Stamp creator",
        short: "Stamp",
        hint: ".svg / .xcs / .xs → stamp",
        blurb: "Turn a design into a rubber stamp: the laser removes the background and leaves your artwork standing proud — mirroring included, and a base plate and handle cut to match.",
        // The universal invert glyph: a circle with one half solid.
        icon: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
        iconFill: "M12 3a9 9 0 0 1 0 18Z",
        accepts: ".svg, .xcs, .xs",
        title: "Stamp creator — turn a design into a laser-cut rubber stamp | LaserKit",
        description: "Free in-browser stamp maker: invert a vector design so every filled area comes out empty and every empty area filled, on a rectangular, elliptical or round plate, mirrored ready to print. Cuts the base plate and a handle — discs, knob, bar or arch — to go with it. Exports DXF, Falcon Design Space (.fds) and SVG."
    }
];

export const getTool = (id: string): ToolDef => {
    const oTool = TOOLS.find(o => o.id === id);
    if (!oTool) throw new Error(`unknown tool: ${id}`);
    return oTool;
};
