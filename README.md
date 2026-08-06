# XToolConverter

**Live: [bbraeu.github.io/XToolConverter](https://bbraeu.github.io/XToolConverter/)**

Free, in-browser converter for xTool project files — both xTool Creative Space
`.xcs` and xTool Studio `.xs` — with the laser operation types (surface
engraving, line engraving, line cutting) preserved. Files never leave your
computer.

Successor of [XCStoDXF](https://github.com/bbraeu/XCStoDXF), based on
[XCStoSVG by Daniel Nanovski](https://nanovsky.github.io/XCStoSVG/) —
maintained by [bbraeu](https://github.com/bbraeu).

## Input formats

| Format | App | Notes |
| --- | --- | --- |
| **.xcs** | xTool Creative Space | plain JSON project file |
| **.xs** | xTool Studio | ZIP archive (`xcs-workspace-v2`) holding the same model split into parts |

## Output formats

| Format | Operations | Notes |
| --- | --- | --- |
| **DXF** (default) | colour-coded (ACI) | AutoCAD R2000, single layer, read by LightBurn / Fusion / any CAM tool |
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

The second tool in the app traces the **cut line around a design** — for the
backing plate you glue the original on top of. It takes an `.svg` or the same
`.xcs` / `.xs` projects, and the geometry comes from the very same extraction the
DXF export uses, so the outline is traced around exactly what would be cut.

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

An SVG that states no physical size is read at 96 dpi (what every importer
assumes) and the width can be corrected in the panel; `.xcs` coordinates are
millimetres already.

## Project settings

What a DXF/SVG/FDS cannot carry is shown under the preview instead: machine and
laser module, material slot with thickness and focal length, air-assist and
purifier gears, the material's precaution codes, and a per-operation table of
power / speed / passes / density — the numbers to re-enter as cut settings after
importing. A dropdown converts that table for another laser module (diode, IR,
CO₂) by holding the energy delivered per millimetre constant; see
`src/lib/lasers.ts` for the arithmetic and its limits.

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

## Stack

[Astro](https://astro.build) + React (converter island) + Tailwind CSS v4,
written in TypeScript. Deployed to GitHub Pages via `.github/workflows/static.yml`.

## Development

```sh
pnpm install
pnpm dev       # local dev server
pnpm check     # typecheck (astro check)
pnpm build     # production build to dist/
```
