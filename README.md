# LaserKit

**Live: [bbraeu.github.io/LaserKit](https://bbraeu.github.io/LaserKit/)**

Free, in-browser tools for laser cutting and engraving. Files never leave your
computer — every tool parses, computes and writes entirely in the browser.

Grew out of XToolConverter, which is now the converter tool inside the kit. The
repository was renamed with it, so the site moved from
`bbraeu.github.io/XToolConverter/` to `bbraeu.github.io/LaserKit/` — GitHub
redirects the repository URL, but not the Pages one, so old links to the site
itself no longer resolve.

Successor of [XCStoDXF](https://github.com/bbraeu/XCStoDXF), based on
[XCStoSVG by Daniel Nanovski](https://nanovsky.github.io/XCStoSVG/) —
maintained by [bbraeu](https://github.com/bbraeu).

## The tools

Each tool is a page of its own with its own title and description; the list in
`src/lib/tools.ts` is what the header menu, the landing page's launcher and the
switcher on every tool page are all built from. Adding a tool means an entry
there plus a page that names it.

| Page | Tool | In → out |
| --- | --- | --- |
| `/convert/` | **xTool project converter** | `.xcs` / `.xs` → DXF · FDS · SVG |
| `/contour/` | **Outer contour tracer** | `.svg` / `.xcs` / `.xs` → cut line |
| `/trace/` | **Trace an image** | `.png` / `.jpg` / `.gif` / `.bmp` / `.webp` → vectors |
| `/text/` | **Text generator** | type → keychain · sign · stencil |
| `/stamp/` | **Stamp creator** | `.svg` / `.xcs` / `.xs` → stamp |

`/invert/`, where the stamp creator lived while it was called *Invert a design*,
is kept as a redirect page — a static host cannot answer with a 301, so it
carries a canonical link, a meta refresh and a `location.replace()`.

The converter, contour tracer and stamp creator all read a dropped file through the
same `src/lib/design.ts` — one `DesignDoc` per canvas, geometry in millimetres
with curves already flattened — so every tool works on exactly what would be cut.
The image tracer starts from pixels instead, and joins the others at the point
where geometry becomes a DXF, an `.fds` or an SVG. The text generator has no
input file at all: the document is the text.

### Passing work between tools

The tools chain in real work — trace a logo into vectors, *then* make a stamp of
it — so **Send to** hands the current result straight to the next tool instead of
routing it through the download folder. The sender puts its own SVG output into
`sessionStorage` and navigates; the receiver picks it up on load and feeds it to
the very same reader a dropped file goes through, showing *from …* under the file
name (`src/lib/handoff.ts`, `src/workspace/SendToMenu.tsx`).

It sits in the toolbar beside Export, because both are outputs of the document —
but outlined in the accent rather than filled with it, and carrying a share arrow
rather than a tray arrow. Export writes a file and ends the job; this one saves
nothing and moves you somewhere else, and it has to look it.

The payload is always an SVG in millimetres, which is what every tool that takes
a design already reads, so the receiving end needs to know nothing about where it
came from. Anything that produces geometry can send (converter, image tracer,
contour tracer, stamp creator); the two tools that take a design can receive
(`HANDOFF_TARGETS`). It is consumed on read, so a reload starts from the drop
zone rather than silently re-importing.

## Input formats

| Format | App | Notes |
| --- | --- | --- |
| **.xcs** | xTool Creative Space | plain JSON project file |
| **.xs** | xTool Studio | ZIP archive (`xcs-workspace-v2`) holding the same model split into parts |
| **.svg** | anything | contour tracer and stamp creator only; read at 96 dpi when it states no physical size |
| **.png / .jpg / .gif / .bmp / .webp** | anything | image tracer only; pixels, read at 96 dpi unless a width is given |

## Output formats

| Format | Operations | Notes |
| --- | --- | --- |
| **DXF** | colour-coded (ACI) | AutoCAD R2000, single layer, read by LightBurn / Fusion / any CAM tool |
| **FDS** | natively assigned layers | Falcon Design Space project — engrave & cut modes pre-assigned on import |
| **SVG** | colour-coded strokes/fills | The only output that carries raster images |

All three carry real-world millimetres: the DXF declares `$INSUNITS = 4`, `.fds`
coordinates are mm natively, and the SVG states `width="430mm" height="390mm"`
alongside its `viewBox` — without a physical size an importer applies 96 dpi to
the user units and the design lands 3.78× too small.

Raster images (`BITMAP` displays) are embedded in the SVG output at their placed
size. DXF and FDS can only store vector geometry — DXF's only raster entity is a
reference to an external file, and an `.fds` shape is a QPainterPath outline — so
for a canvas containing an image those two formats are not offered at all,
rather than handing out a file with the picture silently missing. In the preview
(and only there) a raster is tinted to its operation colour, so it reads as
"yellow = bitmap engraving" like every other shape; the exported pixels are left
untouched, since laser software maps an image's luminance to laser power.

## Outer contour

Traces the **cut line around a design** — for the backing plate you glue the
original on top of.

- A design is split into **items**: every subpath is treated as a ring, and a ring
  is an item when no other ring contains it. Holes and inner detail therefore drop
  out by themselves, and things standing side by side come out as separate items —
  trace all of them, or switch to *individual* and click the ones you want.
- **Border 0 mm is exact**: the item's outermost path *is* the cut line, at the
  0.01 mm the curve flattener works to. Give it a border and the offset is
  computed on a fine grid instead (the reported accuracy, typically 0.03 mm),
  because offsetting a polygon outwards means resolving the self-intersections it
  creates at every concave corner.
- **Connecting** several items into one plate: *shrink-wrap* closes the mask with
  the reach the gaps need, so one smooth outline sweeps from item to item and hugs
  each; *bridges* adds a 4 mm neck along the shortest route, filleted where it
  meets an item; *taut band* is the convex hull. The automatic reach opens up until
  the selection really is one piece — closing bridges two parallel edges at half
  their gap, but pinches back apart between round or pointy shapes.
- Two exports: the cut line alone, or the cut line in red together with the traced
  design in black.

## Stamp creator

Swaps filled and empty: every area the design covers comes out untouched, and
everything around it comes out engraved away — so the artwork stands proud of the
plate. That is what engraving a **rubber stamp** needs, and what makes stencils,
inlays and any "engrave the background" job.

- **Exact geometry, not a re-traced picture.** A design's filled area is already
  defined by nesting: an outermost ring is filled, a ring inside it is a hole, a
  ring inside that is filled again — which is the even-odd fill rule. So one more
  ring *around* everything shifts every region up a level of nesting and flips it:
  the plate becomes filled, each shape becomes a hole in it, and the counter of an
  "o" becomes solid again. The whole inversion is a single path — the frame
  followed by every ring of the design — drawn even-odd. Nothing is resampled, so
  the result is accurate to the 0.01 mm the curves were flattened to.
- **The plate** is a rectangle (bounding box + margin, with an optional corner
  radius), an ellipse of the design's own proportions passing through the corners
  of that box, or a circle reaching its far corner. Whether the artwork actually
  fits inside a rounded or elliptical plate is asked point by point, in closed
  form, and said out loud when it does not.
- **Naming the size is the default** — *Set the size*, 50 mm wide, with the
  height following the design's own proportions until you type one over it. The
  plate comes out exactly the millimetres you asked for and the design is scaled
  to fit inside it, margin and proportions kept, because "a 40 × 15 mm stamp" is a
  thing you order while "a design plus 3 mm" is not. Retyping the size refits the
  canvas to it. `fitScale()` is the closed-form inverse of each of the three plate
  constructions, so a size taken off the current plate comes back as exactly 1 and
  switching the toggle moves nothing.
- **Mirroring** flips the design about its own centre, leaving the plate where it
  was — a stamp prints back-to-front, so it has to be engraved that way.
- **Overlaps are checked for.** Alternating fill is the design's own meaning only
  while its shapes do not cross; where two filled shapes overlap, even-odd reads
  the overlap as a hole, which would engrave a crack through what should be one
  solid piece. Ring pairs whose boxes meet without one holding the other are
  tested for real edge crossings (`segsCross`, budget-capped) and the warning names
  the fix: union them first.
- Repeats the plate's edge in cutting red by default, so one file both engraves
  the background and frees the piece from the sheet.
- **The handle** (*Handle & parts* tab, `src/lib/stamp.ts`) comes off the plate's
  own parameters, so a round stamp gives true circles and a rounded rectangle
  keeps its corner radius — exactly, at any size. One SVG sheet in millimetres,
  cut lines red and the glue positions in engraving green: a **base plate** the
  size of the whole stamp with the handle's footprint engraved on it, plus one of
  four grips — a **disc** stack, a graded **knob**, a **bar** across the back, or
  an **arch** of two uprights and a grip bar you get your fingers under. A laser
  builds a 3D grip the only way it can, in layers, so the sheet thickness decides
  how many pieces a 20 mm grip takes (seven of 3 mm ply, three of 6 mm acrylic) —
  and layers, diameter, bar length and upright height are all then adjustable.
  The sheet is previewed in its own tab under the canvas, pannable and zoomable
  like the workbench itself.

## Trace

Turns a bitmap into vector paths, with the controls of LightBurn's *Bild
nachzeichnen* — whose German labels are potrace's parameters, so the numbers
transfer: **Schwelle** is the threshold, **Glätte** is `alphamax`, **Optimieren**
is `opttolerance`, **Ignoriere weniger als** is `turdsize`.

- **Outline** mode takes the boundary of everything darker than the threshold,
  holes included. The bitmap is decomposed by tracing a boundary, flipping
  everything it encloses, and going round again — so each pass finds the next
  level of nesting, and the even-odd fill rule then means exactly what the nesting
  does. No polarity has to be recorded.
- **Centreline** mode (LightBurn's *Sketch nachzeichnen*) thins each stroke to a
  one-pixel skeleton first, so a 2 mm pen line becomes a single path to engrave
  rather than a long thin outline to cut around. Thinning and skeleton extraction
  are [skeleton-tracing](https://github.com/LingDong-/skeleton-tracing) by
  Lingdong Huang (MIT); the fragments it returns are spliced back into chains here
  so a junction does not become a kink.
- **Corners survive.** Whether a vertex is rounded into a curve or kept as a
  corner is decided from its *normalised sagitta* — its distance from the chord
  between its neighbours, over the length of that chord. That is scale-free, so at
  the default a traced circle becomes curves while a traced square comes out as
  four nodes and four right angles. `Glätte 0` gives a plain polygon.
- **Node reduction is measured, not assumed.** Douglas–Peucker reports the largest
  deviation it actually accepted, which is what the accuracy figure shows. It runs
  at half a pixel plus Optimieren, because a traced boundary is a staircase and
  that much has to be absorbed before the slider adds anything — pre-smoothing the
  path instead would round real corners off.
- Big images are traced at a working size (1600 px for outlines, 900 for
  centrelines) so the sliders stay live; the physical size still comes from the
  source pixels.
- The preview shows the traced vectors over the source image faded in, and can mark
  every node — the two things that make a threshold judgeable rather than guessable.

The outline half is this project's own code, written from the published
polygon-tracing approach rather than ported: every potrace binding on npm is
GPL-2.0, which would spread to the whole of LaserKit.

An SVG that states no physical size is read at 96 dpi (what every importer
assumes) and the width can be corrected in the panel; `.xcs` coordinates are
millimetres already.

## Text generator

Type a word, pick any font installed on the machine, and get cuttable geometry
back — no "convert text to paths" step in another program first.

- **Any font, no upload.** A browser will not hand over glyph outlines: a canvas
  can *draw* text but not say where its edges are, and an SVG `<text>` is a
  promise the importer has to keep rather than a shape. So the word is rendered
  large and put through `src/lib/trace.ts`. That buys every typeface on the
  machine, the browser's own kerning and ligatures, and one honest cost — the
  outline is fitted to a raster, so it is accurate to the figure in the status
  bar rather than exactly. Dropping a `.ttf` / `.otf` / `.woff` / `.woff2`
  registers it through `FontFace` for a face that is not installed.
  `src/lib/fonts.ts` probes which families really exist by measuring a string
  against three fallbacks — `queryLocalFonts()` is Chromium-only and behind a
  permission prompt.
- **The render is scaled to the glyph, not to the millimetres.** The tracer's
  corner detection and node reduction both work in pixels, so a fixed px/mm
  would melt a 6 mm keychain while a 60 mm sign came out crisp. The capital is
  pinned to a constant pixel height instead, so fidelity is the same at every
  size. Text also needs *no* curve-fitting: the tracer's defaults are tuned for
  a rasterised photo edge that should become a curve, and on a letter they round
  the corner off every stem — round Arial's corners and it stops being Arial. So
  Smooth and Simplify both start at 0 here, and the outline follows the glyph
  vertex for vertex.
- **Cap height, not font size.** A font's em is bigger than its capitals by an
  amount that differs per typeface, so "24 pt" says nothing about the material.
  Set 20 mm and a capital is 20 mm, in any face, descender or not.
- **The plate is the contour tracer.** The traced glyphs are subpaths in
  millimetres, so `buildOutline` welds them into one piece exactly as it does
  for `/contour/` — same border, same *shrink-wrap*, *bridges* and *taut band*.
- **Letters that overlap.** Tighten the spacing past touching and the word
  becomes one silhouette — an *rn* reads as an *m*. *Engrave where letters
  overlap* traces every glyph on its own, stacks them left to right the way
  sheets of paper lie, and engraves a contour only where it laps over an
  earlier letter *and* is not covered by a later one. Everywhere else the cut
  line already shows the shape. The first letter gets nothing.
- **The keyring hole** takes an edge, a position along it, an inset and a wall.
  The wall is the useful part: the material around the hole is added to the
  design *before* the outline is traced, so a hole placed off the end of a word
  grows its own lug rather than breaking out of thin air. If it still lands off
  the plate, the status bar says so.

## Project settings

What a DXF/SVG/FDS cannot carry is shown under the converter's preview instead:
machine and laser module, material slot with thickness and focal length,
air-assist and purifier gears, the material's precaution codes, and a
per-operation table of power / speed / passes / density — the numbers to re-enter
as cut settings after importing. A dropdown converts that table for another laser
module (diode, IR, CO₂) by holding the energy delivered per millimetre constant;
see `src/lib/lasers.ts` for the arithmetic and its limits.

Material names are only shown when the project embeds them: current xTool
versions store just the numeric id from their online catalogue, so `Material
#1125` is what the file actually says.

## How it works

- `.xcs` files are plain JSON. Geometry lives in `canvas[].displays[]`; the
  operation type per shape lives in `device.data.value` (a serialised Map of
  `displayId → processingType`).
- `.xs` files (xTool Studio) are ZIP archives with the same model split into
  parts: `canvases/<id>/displays-<n>.json` (geometry, chunked),
  `vectors/<bucket>/data-<n>.json` (deduplicated `dPath` strings referenced via
  `vectorRef`), `resources/<hash>.<ext>` (raster images referenced via
  `resourcePath`, where v1 embedded a base64 data URL inline),
  `profiles.json` (profile → `processingType` plus its parameter `values`) and
  `devices/device-<id>.json` (bindings: profile → display ids, and the `patches`
  that override a profile's values per material preset).
  `src/lib/xs.ts` reassembles them into the `.xcs` shape — inlining vectors and
  re-encoding referenced rasters as data URLs — so the rest of the pipeline is
  shared.
- Shapes are rendered into an off-screen SVG (reusing the preview builders),
  positioned via the browser's `getCTM()`, and bezier curves are adaptively
  flattened to polylines at 0.01 mm.
- **DXF**: `LWPOLYLINE`s on a single layer, coloured by operation (ACI):
  blue = surface engraving, green = line engraving, red = cutting. Colours
  (not layers) are used because Falcon Design Space rearranges separate DXF
  layers on import.
- **FDS**: the native Falcon Design Space container — blocks of
  `[u32 LE length][u32 BE raw size][zlib]` (Qt `qCompress`) holding JSON with
  QPainterPath-style geometry. Operation modes: 0 = surface engraving,
  1 = line engraving, 2 = line cutting (air assist on).
- **Outline** (`src/lib/outline.ts`): items from ring containment, the border and
  every grid-based connection from an exact Euclidean distance transform
  (Felzenszwalb & Huttenlocher) over a filled bitmap, and marching squares to walk
  the result back out to a polyline.
- **Trace** (`src/lib/trace.ts`): threshold → boundary decomposition by
  trace-and-flip (or thinning, for centrelines) → Douglas–Peucker → per-corner
  curve fitting. Split into `prepareTrace` and `buildTrace` so that dragging Smooth
  or Optimize re-fits curves to an already-decomposed bitmap instead of
  re-thresholding two million pixels.
- **Stamp** (`src/lib/invert.ts`, `src/lib/stamp.ts`): ring nesting depth, a
  closed-form plate, and one even-odd path. DXF has no fills, so every ring goes out as a closed contour
  in the engraving colour and the alternation is left to the laser software —
  which is how LightBurn, Falcon and xTool fill nested contours anyway; an `.fds`
  shape is a QPainterPath, whose default rule is odd-even.

## The workspace

Every tool runs inside one shell (`src/workspace/`), laid out the way a design app
is:

```
+---------------------------------------------------------------+
| Toolbar    New . Open . Undo/Redo . Send to . Export           |
+-----------+---------------------------------------+-----------+
|           |                                       |           |
| Sidebar   |               Stage                   | Inspector |
|  "what"   |     the drawing, rulers, grid         |   "how"   |
|           |                                       |           |
+-----------+---------------------------------------+-----------+
| Statusbar  size . points . accuracy . notes . zoom             |
+---------------------------------------------------------------+
```

One rule decides where a control goes. **Left** answers *which thing* — which
file, which canvas, which preset, which step of your own history. **Right**
answers *how* — every property of the drawing, and nothing global. **Top** is
what is true of the document at any moment, including everything it can write.
**Bottom** is what the tool worked out. Nothing appears in two of them.

- `Workspace.tsx` composes the regions and owns the keyboard shortcuts
  (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+O`, `0` to fit, `+` / `-` to zoom).
- `hooks/useDocumentSource.ts` — the open file: one document per canvas, which
  one is current, busy/error, and the hand-over pickup. One copy, four tools.
- `hooks/useHistoryParams.ts` — a tool's settings as one object with a past and a
  future. A slider drag coalesces into a single undo step; settings marked
  *transient* belong to the open file and are the only ones a new file resets and
  the only ones never persisted to `localStorage`.
- `hooks/useDebouncedBuild.ts` — the debounced rebuild, publishing the result and
  its fit key in one state update so the view can never refit to the drawing on
  its way out.
- `hooks/usePanZoom.ts` — pan and zoom written straight onto the SVG element.
  Nothing re-renders while you drag: the rulers, the grid and the readouts
  subscribe through one rAF-throttled callback and update imperatively.
- `rulers.ts` — millimetre spacing off the 1-2-5 ladder, so one grid square is
  always a round number of millimetres at any zoom.

UI primitives are shadcn/ui components in `src/components/ui/` (Radix + CVA), with
Lucide icons.

A tool page is the workspace and nothing else: exactly one screen, no page
scroll. Each page still carries its own heading, lead and explainer cards — in a
server-rendered `<dialog>` opened by **How this tool works** at the foot of the
left panel, so the copy is still in the HTML for crawlers while the tool is what
meets you. Panel scrollbars are transparent until the panel is hovered or
focused, so neither one frames the drawing when nothing is scrolling.

## Stack

[Astro](https://astro.build) + React (one island per tool) + Tailwind CSS v4,
written in TypeScript. Deployed to GitHub Pages via `.github/workflows/static.yml`.

Runtime dependencies: `fflate` and `client-zip` for the ZIP formats,
`skeleton-tracing-js` (MIT) for centreline thinning, and Radix UI + Lucide behind
the shadcn/ui components. Everything else — DXF, FDS, contour offsetting,
inversion, outline tracing — is in `src/lib`.

## Releases

Every push to `main` runs `.github/workflows/static.yml`: typecheck, unit tests
and the end-to-end suite, then the build, then the deploy, then a GitHub
release. A red test stops the deploy, and a failed deploy stops the release —
so a release only ever exists for something that actually went live.

The version comes from `package.json` as a *floor*: raise it there and that is
the release (a deliberate major or minor), leave it alone and the patch ticks up
from the newest tag. So a routine copy fix becomes `3.0.1` without ceremony, and
`3.1.0` still means somebody decided it did. Each release carries auto-generated
notes and a zip of the built site, for running the tools offline.

Worth knowing before debugging a failure:

- Run the suite as CI does before pushing — `CI=1 pnpm test:e2e` drops to two
  workers, which is how a race that eight workers hide shows itself.
- A red *Pages* step does not always mean the site is stale; the deploy action
  has timed out on a deployment that had already been applied. Check the live
  URL first, and never re-run the same sha — an empty commit is what gets a
  fresh deployment id.

## Development

```sh
pnpm install
pnpm dev          # local dev server
pnpm check        # typecheck (astro check)
pnpm build        # production build to dist/
pnpm test         # unit tests (vitest)
pnpm test:e2e     # end-to-end (playwright; builds and previews first)
```

`pnpm check` is not run by CI — run it by hand before pushing.
