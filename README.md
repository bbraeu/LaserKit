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
| `/stamp/` | **Stamp creator** | `.svg` / `.xcs` / `.xs` → stamp |

`/invert/`, where the stamp creator lived while it was called *Invert a design*,
is kept as a redirect page — a static host cannot answer with a 301, so it
carries a canonical link, a meta refresh and a `location.replace()`.

The converter, contour tracer and stamp creator all read a dropped file through the
same `src/lib/design.ts` — one `DesignDoc` per canvas, geometry in millimetres
with curves already flattened — so every tool works on exactly what would be cut.
The image tracer starts from pixels instead, and joins the others at the point
where geometry becomes a DXF, an `.fds` or an SVG.

### Passing work between tools

The tools chain in real work — trace a logo into vectors, *then* make a stamp of
it — so **Send to other tool** hands the current result straight to the next tool
instead of routing it through the download folder. The sender puts its own SVG
output into `sessionStorage` and navigates; the receiver picks it up on load and
feeds it to the very same reader a dropped file goes through, showing *handed over
from …* next to the file name (`src/lib/handoff.ts`, `src/components/SendTo.tsx`).

It sits in its own row directly under the preview, closed off by a rule, and is
styled as a quiet cyan link with an arrow rather than as a button — it saves
nothing and navigates. The controls that *do* write a file all carry a tray arrow
and stay together in the panel header, out of its way.

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
- **Or name the size** — *Set the stamp size* turns it around: the plate is
  exactly the millimetres you type and the design is scaled to fit inside it,
  margin and proportions kept, because "a 40 × 15 mm stamp" is a thing you order
  while "a design plus 3 mm" is not. `fitScale()` is the closed-form inverse of
  each of the three plate constructions, so a size taken off the current plate
  comes back as exactly 1 and ticking the box moves nothing.
- **Mirroring** flips the design about its own centre, leaving the plate where it
  was — a stamp prints back-to-front, so it has to be engraved that way.
- **Overlaps are checked for.** Alternating fill is the design's own meaning only
  while its shapes do not cross; where two filled shapes overlap, even-odd reads
  the overlap as a hole, which would engrave a crack through what should be one
  solid piece. Ring pairs whose boxes meet without one holding the other are
  tested for real edge crossings (`segsCross`, budget-capped) and the warning names
  the fix: union them first.
- Optionally repeats the plate's edge in cutting red, so one file both engraves the
  background and frees the piece from the sheet.
- **The parts around the stamp** (`Download base stamp objects`, `src/lib/stamp.ts`)
  come off the plate's own parameters, so a round stamp gives true circles and a
  rounded rectangle keeps its corner radius — exactly, at any size. One SVG sheet
  in millimetres, cut lines red and the handle's glue position in engraving green:
  a **base plate** the size of the whole stamp with a ⌀ 15 mm circle engraved at
  its centre, **five ⌀ 15 mm discs** that stack into the handle, a **cap lid** 2 mm
  larger all round, and **two rings** of that outer size with a 1 mm wall — glued
  under the lid they make a cap the stamp slides into with 1 mm of play.

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
  curve fitting. Split into `prepareTrace` and `buildTrace` so that dragging Glätte
  or Optimieren re-fits curves to an already-decomposed bitmap instead of
  re-thresholding two million pixels.
- **Stamp** (`src/lib/invert.ts`, `src/lib/stamp.ts`): ring nesting depth, a
  closed-form plate, and one even-odd path. DXF has no fills, so every ring goes out as a closed contour
  in the engraving colour and the alternation is left to the laser software —
  which is how LightBurn, Falcon and xTool fill nested contours anyway; an `.fds`
  shape is a QPainterPath, whose default rule is odd-even.

## Stack

[Astro](https://astro.build) + React (one island per tool) + Tailwind CSS v4,
written in TypeScript. Deployed to GitHub Pages via `.github/workflows/static.yml`.

Runtime dependencies are deliberately few: `fflate` and `client-zip` for the ZIP
formats, and `skeleton-tracing-js` (MIT) for centreline thinning. Everything else —
DXF, FDS, contour offsetting, inversion, outline tracing — is in `src/lib`.

## Development

```sh
pnpm install
pnpm dev       # local dev server
pnpm check     # typecheck (astro check)
pnpm build     # production build to dist/
```

`pnpm check` is not run by CI — run it by hand before pushing.
