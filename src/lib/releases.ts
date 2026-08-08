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
        version: "3.15.0",
        date: "2026-08-08",
        title: "Calendar controls that do what they say",
        tools: ["calendar"],
        notes: [
            "Fixed: a card had no margin unless you also turned the frame on. The cut line is the edge of a card, so without a margin it ran straight through the last column of days — and the margin slider was on screen the whole time, apparently doing nothing. A card always has its margin now, and it is called Card margin rather than Frame margin, because that is what it is.",
            "Fixed: framing the months on a single board cut it into twelve. The rectangles were drawn as cuts, which is right on cards and turns a year board into twelve cards and a piece of scrap. They are engraved now, which is what the tooltip claimed all along.",
            "On cards, Frame each month has become Rule inside each card: an engraved rectangle set in from the cut edge, with its own inset. A second cut line two millimetres inside the first would only ever produce a card and a picture frame.",
            "The labels follow the mode now — Between cards, Card corners, Card margin on cards; Between months, Frame corners, Frame margin on a board — so nothing is named after the thing it does in the other layout.",
            "The headings switch is on screen in both modes now. It was hidden on cards while still being obeyed there, so the cards came out with whatever it had been left at on a board and there was no way to see it, let alone change it.",
            "The tool says something when the card margin is under two millimetres, which is where the char from the cut starts showing up in the numbers."
        ]
    },
    {
        version: "3.14.0",
        date: "2026-08-08",
        title: "Mandala motifs that are built rather than sampled",
        tools: ["mandala"],
        notes: [
            "Seven new motifs: rosettes, stars, arrows, paisley, crescents, chevrons and a Greek key.",
            "The first eight motifs were all the same kind of shape, and that was the ceiling. Each was one closed curve, symmetric about its slot and bulging outwards — so it could be a petal, a lens, a rhombus or a slot, and it could never be a star (two radii), an arrow (not symmetric end to end) or a rosette (seven shapes rather than one). No amount of taste in the curve gets there.",
            "The new ones are drawn in a coordinate system of their own — as any number of closed rings made of straight runs, arcs and thickened centrelines — and then bent onto the band so a point sits the same distance round the circle whatever radius it lands at. That is what stops a star being a starfish on the inner ring and a snowflake on the outer.",
            "Mixed now draws from fifteen motifs instead of eight, so the preset most people start from is a good deal less predictable.",
            "The web is now worked out over every point of a motif rather than its widest one. The widest point is not where two neighbours come closest: a point eats a fixed number of millimetres of the circle whatever radius it is at, so the room it takes grows as the radius shrinks. An arrow's fletching is narrower than its head and much further in, and it is the fletching that decides the gap — the old figure was optimistic by about half a millimetre for shapes like that."
        ]
    },
    {
        version: "3.13.0",
        date: "2026-08-08",
        title: "Calendar cards, frames, and a tray to keep them in",
        tools: ["calendar", "box"],
        notes: [
            "Fixed: the months overlapped. They were held apart by padding each block with spaces, which works exactly as long as the font is monospaced — and the tool has a font picker, so it was one click away from March landing on top of February. Space padding is not a layout. Every month is set on its own now and placed in millimetres, and every cell is the size of the largest, so February being a line shorter cannot move March.",
            "A frame round every month, with a margin you set. On one board it is engraved ruling that makes the table read as a table; on cards it is the cut line.",
            "New: cut the months as twelve separate cards instead of one board. They come out the same size whatever each month needs, so a stack of them is a stack rather than a fan, and they are nested onto a sheet no wider than your bed.",
            "New: a tray to stand the cards in, switched on next to the card option and shown in a panel under the canvas the way the stamp shows its mount. It is the box generator called with the numbers the cards imply — same finger joints, same kerf compensation, same nesting — and it comes out half a card tall so the month you want is readable without taking it out.",
            "The space between months is a real measurement now, in millimetres, rather than three space characters."
        ]
    },
    {
        version: "3.12.0",
        date: "2026-08-08",
        title: "Calendars",
        tools: ["calendar"],
        notes: [
            "New tool. A whole year or a single month as an engravable plaque, in German or English, starting on Monday or Sunday.",
            "Leap years are worked out properly: every four, except every hundred, except every four hundred. 1900 had no 29th of February and 2000 did — and a generator that skips the exceptions is right for ninety-six years in a hundred, which is the worst possible rate for anybody catching it.",
            "Every month block is padded to the same height and width, so the months in a row line up instead of stepping down the page as the short ones need fewer rows.",
            "The status bar says whether the year is a leap year, and the tool asks you to check the dates against a calendar you trust — this is the one thing in the kit that is either right or firewood."
        ]
    },
    {
        version: "3.11.0",
        date: "2026-08-08",
        title: "Word searches",
        tools: ["wordsearch"],
        notes: [
            "New tool. Your own words hidden in a grid of any size, across, down, diagonally and backwards.",
            "Every word on the printed list is actually in the grid. Placement is exhaustive rather than hopeful — every starting square in every allowed direction — and a word that genuinely cannot fit is dropped from the list as well as from the grid.",
            "Among the places a word fits, the one that crosses the most words already placed wins. A grid whose words cross is dense and hard; one where each was dropped in the first empty corner has a suspicious blank middle.",
            "The filler is drawn from the words' own letters, so a stray Q cannot say “nothing here”.",
            "The letters come from the text tool rather than a second glyph pipeline, so a word search gets every font on the machine and the same cap-height sizing as everything else."
        ]
    },
    {
        version: "3.10.1",
        date: "2026-08-08",
        title: "Mandalas that look like mandalas",
        tools: ["mandala"],
        notes: [
            "The first version drew solid blobs, and it showed. A mandala is line work — every one ever drawn is outlined, and only sometimes filled in afterwards — so the motifs are now outlines by default, which is also a fraction of the burn.",
            "Each motif carries a smaller echo of itself inside. That is the other hallmark of a hand-drawn one, and it is what turns a shape into a motif.",
            "Four more motifs: lotus petals drawn out to a sharp point, diamonds, darts, and rings of plain dots. Dots are structural rather than decorative — without one, a run of bands reads as concentric fences.",
            "Mixed now drops a dot ring in between bands rather than only shuffling shapes, and never opens on one."
        ]
    },
    {
        version: "3.10.0",
        date: "2026-08-07",
        title: "Mandalas and sunbursts",
        tools: ["mandala"],
        notes: [
            "New tool. Radial patterns at any diameter and symmetry, in four motifs — petals, drops, spokes and scallops — with a mixed mode that picks a different one per ring from a seed.",
            "Cut through, the pattern is the only structure, so the material left between motifs is computed and reported in millimetres. A mandala that will fall into forty petals on the bed looks exactly like one that will not.",
            "A motif is never wider than the band it sits in is tall, whatever the symmetry. Without that rule a shallow ring gives shapes wider than they are long, and they read as lumps rather than petals.",
            "Every other ring is turned half a slot, so the pattern reads as a weave instead of spokes running hub to rim — and it puts material where its neighbour has a hole.",
            "Ring lines are always engraved, even on a cut mandala: cut, one would come away as a loose ring and take the pattern with it."
        ]
    },
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
