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
        id: "mandala",
        slug: "mandala/",
        label: "Mandala & sunburst",
        short: "Mandala",
        hint: "symmetry → a disc of pattern",
        blurb: "Radial patterns at any size and any symmetry — petals, drops, spokes or scallops — with the material left between them reported in millimetres, because that is what holds a cut one together.",
        // A rosette: a hub with petals round it.
        icon: "M12 3.75c1.5 2 1.5 4 0 6s-1.5 4 0 6 1.5 4 0 4.5M12 3.75c-1.5 2-1.5 4 0 6M20.25 12c-2 1.5-4 1.5-6 0s-4-1.5-6 0-4 1.5-4.5 0M20.25 12c-2-1.5-4-1.5-6 0M18 6a9 9 0 1 1-12 12A9 9 0 0 1 18 6Z",
        accepts: "nothing — it starts from a symmetry",
        title: "Mandala generator for laser cutting and engraving | LaserKit",
        description: "Free in-browser mandala and sunburst generator for laser cutting: radial patterns at any diameter and symmetry with four motifs, concentric rings, a hub and a hanging hole — and the web between motifs measured in millimetres so a cut one does not fall apart. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "celtic",
        slug: "celtic/",
        label: "Celtic tree of life",
        short: "Tree of life",
        hint: "a seed → a tree in a ring",
        blurb: "A tree whose branches and roots both reach into the border, drawn as one silhouette rather than as lines that cross — so the overlaps are joins instead of cuts. Four border styles, leaves that are never too small to survive, and feet to stand it in.",
        // A trunk forking into a canopy, inside a ring.
        icon: "M12 20.25V13.5m0 0-3.75-3.75M12 13.5l3.75-3.75M8.25 9.75 6 6.75m2.25 3-3 1.5m10.5-1.5L18 6.75m-2.25 3 3 1.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
        accepts: "nothing — it starts from a diameter",
        title: "Celtic tree of life generator for laser cutting | LaserKit",
        description: "Free in-browser Celtic tree of life generator for laser cutting: branches and roots growing into a braided, roped or knotwork border, with a leaf size floor so the leaves survive the beam, tabs and feet to stand it up, and every overlap merged into one silhouette so nothing is cut twice. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "qr",
        slug: "qr/",
        label: "QR code",
        short: "QR",
        hint: "a link → a code to engrave",
        blurb: "A QR code as real geometry, with the squares merged into runs so the head is not chasing a thousand of them — and the module size shown, because that is what decides whether a phone can read it.",
        // The three finder patterns and a scatter of modules.
        icon: "M3.75 3.75h6v6h-6zM14.25 3.75h6v6h-6zM3.75 14.25h6v6h-6zM14.25 14.25h2.25v2.25h-2.25zM18 18h2.25v2.25H18zM14.25 18.75v1.5M18.75 14.25h1.5",
        accepts: "nothing — it starts from what you type",
        title: "QR code to SVG or DXF for laser engraving | LaserKit",
        description: "Free in-browser QR code generator for laser cutting and engraving: any text or link as vector geometry at true size, with adjustable error correction, quiet border and module size, plus a cut-tile inlay mode. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "puzzle",
        slug: "puzzle/",
        label: "Jigsaw puzzle",
        short: "Puzzle",
        hint: "a board → interlocking pieces",
        blurb: "A jigsaw of any size and any number of pieces, with knobs that actually undercut — so the pieces hold each other instead of falling apart when you lift it.",
        // Two interlocking pieces.
        icon: "M10.5 3.75a1.5 1.5 0 1 1 3 0v.75h3a1.5 1.5 0 0 1 1.5 1.5v3h.75a1.5 1.5 0 1 1 0 3h-.75v3a1.5 1.5 0 0 1-1.5 1.5h-3v.75a1.5 1.5 0 1 1-3 0v-.75h-3a1.5 1.5 0 0 1-1.5-1.5v-3h-.75a1.5 1.5 0 1 1 0-3h.75v-3a1.5 1.5 0 0 1 1.5-1.5h3v-.75Z",
        accepts: "nothing — it starts from a board size",
        title: "Jigsaw puzzle generator for laser cutting — any size, any piece count | LaserKit",
        description: "Free in-browser jigsaw puzzle generator for laser cutting: any board size and piece count, with a classic undercut knob so the pieces interlock, adjustable variation and knob size, a seed you can return to, and every joint cut exactly once. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "calendar",
        slug: "calendar/",
        label: "Calendar",
        short: "Calendar",
        hint: "a year → a plaque to engrave",
        blurb: "A whole year or a single month as an engravable plaque, in German or English, starting on Monday or Sunday — with the leap years worked out properly.",
        // A page with a header row and a grid of days.
        icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5",
        accepts: "nothing — it starts from a year",
        title: "Calendar generator for laser engraving — any year, any month | LaserKit",
        description: "Free in-browser calendar generator for laser cutting and engraving: a whole year or a single month as a plaque, in German or English, with the week starting on Monday or Sunday and leap years worked out properly. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "wordsearch",
        slug: "wordsearch/",
        label: "Word search",
        short: "Word search",
        hint: "a list of words → a grid to engrave",
        blurb: "Hide a list of words in a grid of letters, in any direction, with a filler drawn from the words themselves — and never a word on the list that is not in the grid.",
        // A grid with a word running through it.
        icon: "M3.75 3.75h16.5v16.5H3.75zM3.75 9h16.5M3.75 14.25h16.5M9 3.75v16.5M14.25 3.75v16.5",
        accepts: "nothing — it starts from a list of words",
        title: "Word search generator for laser engraving — any size, any words | LaserKit",
        description: "Free in-browser word search generator for laser cutting and engraving: hide your own words in a grid of any size, across, down, diagonally and backwards, with a filler drawn from the words’ own letters and a printed word list. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "maze",
        slug: "maze/",
        label: "Maze generator",
        short: "Maze",
        hint: "a grid → a maze to engrave",
        blurb: "A perfect maze at any size, with one route between any two points — walls engraved, the piece cut out, and a seed so the maze you liked is the maze you get back.",
        // A path turning through a grid: the thing itself.
        icon: "M3.75 3.75h16.5v16.5H3.75zM3.75 8.25h9M20.25 12h-7.5M3.75 15.75h9M12.75 8.25v3.75M8.25 15.75v4.5",
        accepts: "nothing — it starts from a grid size",
        title: "Maze generator for laser engraving — perfect mazes, any size | LaserKit",
        description: "Free in-browser maze generator for laser cutting and engraving: a perfect rectangular maze at any size with one route between any two points, an adjustable corridor width, optional loops, a seed you can return to, and the solution as a preview aid. Exports SVG, DXF and Falcon Design Space (.fds)."
    },
    {
        id: "nest",
        slug: "nest/",
        label: "Nest on a sheet",
        short: "Nest",
        hint: ".svg / .xcs / .xs → a full sheet",
        blurb: "Lay as many copies of a design on a sheet as will fit, in rows, with the gap and the margin you set — and with every engraving still an engraving.",
        // Four tiles on a sheet: the thing itself.
        icon: "M3.75 4.5h6.75v6.75H3.75zM13.5 4.5h6.75v6.75H13.5zM3.75 13.5h6.75v6.75H3.75zM13.5 13.5h6.75v6.75H13.5z",
        accepts: ".svg, .xcs, .xs",
        title: "Nest a design on a sheet — laser cutting layout tool | LaserKit",
        description: "Free in-browser nesting tool for laser cutting: fill a sheet with copies of one design, or lay out a set number, with an adjustable gap, an edge margin and an optional quarter turn. Keeps engraving and cutting apart. Exports SVG, DXF and Falcon Design Space (.fds)."
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
