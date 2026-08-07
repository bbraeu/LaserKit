// ---------------------------------------------------------------------------
// What changed, and when.
//
// Written here rather than fetched from the GitHub API, for two reasons. A
// build that needs the network is a build that can fail for a reason nothing to
// do with the code, and an unauthenticated API call from a visitor's browser is
// rate-limited per IP — so the one page that exists to say "here is what this
// thing does now" would be the page most likely to be empty.
//
// The cost is that shipping means adding an entry. That is the right cost: a
// release nobody could be bothered to describe is a release nobody needed.
//
// Newest first. `notes` are what actually changed for someone using the tools,
// not a list of commits — the commits are one click away on GitHub.
// ---------------------------------------------------------------------------

export interface Release {
    /** without the leading v */
    version: string;
    /** ISO date the release went out */
    date: string;
    title: string;
    /** ids from tools.ts that this release touched */
    tools?: string[];
    /** one line each, in the order they matter */
    notes: string[];
}

export const REPO = "https://github.com/bbraeu/LaserKit";

export const RELEASES: Release[] = [
    {
        version: "3.9.0",
        date: "2026-08-07",
        title: "QR codes",
        tools: ["qr"],
        notes: [
            "New tool. Any text or link as vector geometry at true size, with the error correction, the quiet border and the plate all adjustable.",
            "The module size is a status-bar figure that turns amber, because that is the one number that decides whether a phone can read it — under about 0.6 mm the beam's own width is a large fraction of a square.",
            "Runs of dark squares along a row are merged into one rectangle each: a version 5 code is over a thousand squares, and unmerged the head spends most of the job travelling between them.",
            "Cutting is offered only as an inlay, because a QR code cannot be cut out of one piece — the middle of every finder pattern is an island with nothing holding it. The tool says how many loose tiles that makes.",
            "The encoding comes from a twenty-year-old dependency rather than being written here: a wrong QR code looks exactly like a right one, and this project cannot decode one to tell."
        ]
    },
    {
        version: "3.8.1",
        date: "2026-08-07",
        title: "Puzzle pieces that actually differ",
        tools: ["puzzle"],
        notes: [
            "The variation slider is now a difficulty slider, and it moves three things instead of one. The old one only slid a knob a few per cent along its edge, which left every piece looking the same.",
            "The biggest addition: the corners of the lattice wander, so the pieces are different sizes and the joints stop being straight lines. A knob in a different place is a detail; a piece of a different size is a different piece.",
            "Each knob also varies in size, capped to a share of its own edge so it cannot swallow a piece whose corner has wandered close.",
            "Both joints meeting at a corner still read it from the same place, so however far it has moved they meet exactly."
        ]
    },
    {
        version: "3.8.0",
        date: "2026-08-07",
        title: "The jigsaw puzzle generator",
        tools: ["puzzle"],
        notes: [
            "New tool. Any board size, any number of pieces, with the classic undercut knob — the neck is narrower than the head, which is the only reason a finished puzzle can be slid across a table in one piece.",
            "Every joint is cut once. A piece and its neighbour share it, so cutting each piece's own outline would send the beam down every internal line twice: twice the job, and the joint burnt a full extra kerf loose.",
            "Variation moves each knob along its edge and never touches the neck. At zero every piece fits every socket, and the tool says so rather than letting you find out after cutting.",
            "The kerf is the fit: the pieces come out about one kerf loose and there is nothing to compensate. Cut a 2 × 2 test first.",
            "A seed, so changing the board size does not reshuffle the pieces."
        ]
    },
    {
        version: "3.7.0",
        date: "2026-08-07",
        title: "The maze generator",
        tools: ["maze"],
        notes: [
            "New tool. A perfect maze at any size — exactly one route between any two points, no loops, no unreachable corners.",
            "The walls are engraved and only the outline is cut, and there is no switch to change that: a wall is a line, and cutting a line gives a slot with nothing holding either side of it.",
            "A seed, because without one dragging the corridor width would reshuffle every wall and the maze on screen would never be the maze you exported.",
            "The way through is drawn on the canvas as a reading aid and is in no export — engraving the answer onto the puzzle would be a strange thing to hand somebody.",
            "Loops are offered and labelled for what they do: they look harder and solve easier.",
            "Collinear walls are merged into one line each, which on a big maze more than halves the job."
        ]
    },
    {
        version: "3.6.0",
        date: "2026-08-07",
        title: "This page",
        notes: [
            "Release notes, on the site rather than only on GitHub — every version since the tools got one, newest first, with the ones that touched a tool linking straight to it.",
            "Written into the repository rather than fetched: a build that needs the network can fail for a reason nothing to do with the code, and an API call from a visitor's browser is rate-limited per address."
        ]
    },
    {
        version: "3.5.0",
        date: "2026-08-07",
        title: "Nesting: a design, as many times as fit",
        tools: ["nest"],
        notes: [
            "New tool. Drop a design and get a full sheet of it — fill the sheet, or lay out a set number and be told how many sheets that takes.",
            "The operations survive. A design's colours say what the laser should do with each part of it, and they are read back in and kept: twenty copies of a keychain whose lettering has become a cut line is twenty ruined blanks.",
            "An unrecognised palette comes out on one unnamed operation to assign yourself, rather than a guess.",
            "Copies are packed as bounding boxes in rows — what a person does by hand, instantly, rather than a solver that runs for minutes and still cannot promise the best answer.",
            "The sheet and its margin are drawn as guides and are in no export: they are where the material is, not something to burn."
        ]
    },
    {
        version: "3.4.1",
        date: "2026-08-07",
        title: "Take the corner controls away from a clamshell",
        tools: ["box"],
        notes: [
            "A hinged lid cannot have rounded corners — its knuckle grows out of a side wall, and a box that wraps has none. The panel used to offer a radius and then ignore it; now the section is simply not there.",
            "If a radius was already set when the lid changed, the status bar says it is being ignored rather than quietly changing the shape."
        ]
    },
    {
        version: "3.4.0",
        date: "2026-08-07",
        title: "Wrap the box: rounded corners on a living hinge",
        tools: ["box", "hinge"],
        notes: [
            "A corner radius turns the four walls into one band that goes all the way round and bends at each corner through a hinge cut into it.",
            "The band's length is the floor's perimeter exactly: the two are the same curve, and a lattice hinge does not stretch.",
            "The floor cannot be notched round a curve, so it carries through-tenons — laid out by the same walk round the perimeter that places the mortises, so they cannot drift apart.",
            "The seam is an in-plane comb joint in the middle of the back, where the material is flattest and least seen.",
            "At radius 0 every part is exactly what it was."
        ]
    },
    {
        version: "3.3.0",
        date: "2026-08-07",
        title: "The living hinge: a panel cut so that it bends",
        tools: ["hinge"],
        notes: [
            "New tool. A field of brick-offset slits that lets a flat sheet roll up, in three patterns: plain, a wave, and T-ends that spread the stress along a line instead of piling it on the point where every failed hinge cracks.",
            "One figure is exact and worth more than any rule of thumb: the twist a row has to take is the row spacing over the radius.",
            "The strain that puts through a link is a rule of thumb, and the tool says so — there is a test-strip preset for the only answer that counts.",
            "The link is held at what you set, because it carries the load; the rows and the slits are rounded to fit the panel exactly."
        ]
    },
    {
        version: "3.2.0",
        date: "2026-08-07",
        title: "Text round a circle",
        tools: ["text"],
        notes: [
            "The baseline switches between straight and an arc. Each letter is moved and turned as a rigid body — bending the outlines themselves fattens the inside of every stem, and an O on a 20 mm badge comes out as an egg.",
            "The letters are set round the circle before anything is traced, so a bent word goes through the same one-render-one-trace pipeline a straight one does, and letters that lap over each other weld instead of cancelling.",
            "Radius is measured to the baseline. Top and bottom are the two halves of a badge at one radius.",
            "Alignment is left out on a circle rather than disabled: every line is centred on the crown, so the control would do nothing."
        ]
    },
    {
        version: "3.1.2",
        date: "2026-08-07",
        title: "The box generator",
        tools: ["box"],
        notes: [
            "New tool. Three numbers in, a sheet of finger-jointed panels out, with the kerf taken off every tooth and added to every notch — the difference between a box you tap together and one you glue and clamp.",
            "Five answers to “does it have a lid?”: none, lay-on with a locating lip, a tray that slips over, a clamshell on a pin, and closed.",
            "The clamshell's pivot hangs behind the back face and above the rim — the one family of positions where opening the lid lifts every point of it at once, so nothing has to be cut away for clearance.",
            "Cross-lapped dividers, a floor that can sit on the ground or stand on a plinth, and the panels nested for your bed."
        ]
    },
    {
        version: "3.1.1",
        date: "2026-08-07",
        title: "Stop the text tests racing their own rebuilds",
        notes: ["Test-only: a baseline read before the debounced rebuild had finished made the suite flaky."]
    },
    {
        version: "3.1.0",
        date: "2026-08-07",
        title: "The text generator, and a stamp you can aim by hand",
        tools: ["text", "stamp"],
        notes: [
            "New tool. Set a word in any font installed on your machine and get it back as cuttable geometry — no upload, no “convert text to paths” step somewhere else first.",
            "Size is the cap height, not the font size: set 20 mm and a capital comes out 20 mm in every typeface.",
            "The letters weld into one plate, with a keyring hole that grows its own lug when it lands off the end of a word.",
            "The stamp's plate can now be dragged into place on the canvas."
        ]
    },
    {
        version: "3.0.2",
        date: "2026-08-07",
        title: "Put the actual commits in the release notes",
        notes: ["Release plumbing: GitHub's generated notes said little more than a compare link, so the commit subjects since the last tag go in ahead of them."]
    },
    {
        version: "3.0.1",
        date: "2026-08-07",
        title: "Cut a release for every deploy",
        notes: [
            "Every deploy now gets a version and a downloadable build — a deploy nobody can name is a deploy nobody can roll back to.",
            "package.json is the floor rather than the answer: raise it for a deliberate minor, leave it alone and the patch ticks up."
        ]
    },
    {
        version: "3.0.0",
        date: "2026-08-07",
        title: "The workspace redesign",
        notes: [
            "Every tool moved into one shell: a toolbar for the document, a sidebar for which thing, the drawing across about three quarters of the width, an inspector for how, and a status bar for what the tool worked out. Nothing appears in two of them.",
            "A tool page is exactly one screen and never scrolls. The explainer copy each page carries for its own search traffic moved into a dialog you open from the left — still in the HTML, one click away.",
            "Undo and redo over the whole settings object, with a slider drag coalescing into one step and every change listed to click back to.",
            "Settings persist per tool, minus the ones that belong to the open file. Presets, keyboard shortcuts, drop-anywhere, panels that remember whether they were open.",
            "Millimetre rulers and a grid whose squares are always a round number of millimetres."
        ]
    },
    {
        version: "2.2.0",
        date: "2026-08-07",
        title: "Stamp creator: parts, a size you name, and tools that chain",
        tools: ["stamp"],
        notes: [
            "“Invert a design” became the stamp creator. The old address stays behind as a redirect.",
            "The rest of the stamp comes out as one sheet: base plate, handle discs, cap lid and rings — every piece from the plate's own parameters, so a round stamp gives true circles at any size.",
            "Set the stamp size and the design is scaled to fit inside it: “a 40 × 15 mm stamp” is a thing you order; “a design plus 3 mm” is not.",
            "Send to another tool: trace a logo, then make a stamp of it, without a round trip through the download folder."
        ]
    },
    {
        version: "2.1.0",
        date: "2026-08-07",
        title: "XToolConverter becomes LaserKit",
        tools: ["trace", "contour"],
        notes: [
            "The converter had outgrown its name. There are now several tools, each on its own page with its own title and explainer copy, all driven by one registry.",
            "New: trace an image. Outline mode traces the boundary of everything past the threshold, holes included; centreline mode thins each stroke to a skeleton first, so a 2 mm pen line becomes one path to engrave rather than a long thin outline to cut.",
            "The site moved to /LaserKit/ — GitHub redirects a repository URL but not a Pages one."
        ]
    },
    {
        version: "1.2.0",
        date: "2026-08-03",
        title: "Only offer formats that can hold the content",
        tools: ["convert"],
        notes: [
            "DXF and Falcon Design Space cannot represent a raster at all — DXF's only raster entity points at an external file, and an .fds shape is an outline — so neither is offered for a canvas containing an image.",
            "Exporting the image as its bounding box was worse than useless: in FDS that layer is a fill, so the box would have been engraved solid where the picture should be.",
            "The restriction is per canvas: a vector-only canvas in the same project still exports as DXF."
        ]
    },
    {
        version: "1.1.0",
        date: "2026-08-03",
        title: "Raster images in .xs projects",
        tools: ["convert"],
        notes: [
            "An xTool Studio archive does not embed rasters inline — the display only points at a file inside the ZIP, and those were never read. Images came out as broken placeholders.",
            "Image width and height were swapped, which flipped every non-square raster and handed DXF and FDS a transposed box.",
            "A non-uniformly scaled raster now fills its box the way it does in the editor."
        ]
    }
];

/** The newest release, for the badge the landing page shows. */
export const LATEST = RELEASES[0]!;
