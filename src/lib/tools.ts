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
        id: "text",
        slug: "text/",
        label: "Text generator",
        short: "Text",
        hint: "type → keychain · sign · badge",
        blurb: "Set a word in any font on your machine and get it back as cuttable geometry — straight or curved round a circle, welded into one plate, with a keyring hole where you want it.",
        // A capital T on a baseline: the one glyph that reads as "text" at 20 px.
        icon: "M4.5 5.25h15M12 5.25V19.5M8.25 19.5h7.5",
        accepts: ".ttf, .otf, .woff, .woff2",
        title: "Text to SVG for laser cutting — keychains, curved text and stencils | LaserKit",
        description: "Free in-browser text generator for laser cutting: set a word in any font installed on your machine, straight or curved round a circle for a badge, weld the letters into one plate, add a keyring hole and export DXF, Falcon Design Space (.fds) or SVG. No font upload needed, nothing leaves your browser."
    },
    {
        id: "box",
        slug: "box/",
        label: "Box generator",
        short: "Box",
        hint: "size → finger-jointed box",
        blurb: "Type three numbers and get the flat panels of a finger-jointed box — lid or no lid, hinged or lay-on, compartments inside, and the kerf already taken out of every tooth.",
        // The one glyph that reads as "box" at 20 px: an isometric cube.
        icon: "m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
        accepts: "nothing — it starts from numbers",
        title: "Laser-cut box generator — finger-jointed, with lid and dividers | LaserKit",
        description: "Free in-browser box generator for laser cutting: finger-jointed boxes at any size, measured inside or outside, with a lay-on, tray, hinged or closed lid, an inset floor, cross-lapped dividers and kerf compensation on every joint. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "hinge",
        slug: "hinge/",
        label: "Living hinge",
        short: "Hinge",
        hint: "a panel → one that bends",
        blurb: "Cut a field of slits into a flat panel so it rolls up — straight, wave or stress-relieved — with the twist every row has to take worked out for the radius you want.",
        // A sheet bending: a curve with the flat it came from behind it.
        icon: "M3 7.5h18M3 7.5c0 6 3.75 9.75 9 9.75s9-3.75 9-9.75M7.5 7.5v9.75M12 7.5v9.75M16.5 7.5v9.75",
        accepts: "nothing — it starts from a panel size",
        title: "Living hinge generator — kerf bending patterns for laser cutting | LaserKit",
        description: "Free in-browser living hinge generator: fill a panel with a brick-offset lattice, wave or T-ended slits so plywood or acrylic bends, with the row spacing, link length and kerf worked out for the radius you need. Exports SVG, DXF and Falcon Design Space (.fds)."
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
