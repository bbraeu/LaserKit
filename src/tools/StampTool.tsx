import { useCallback, useMemo } from "react";
import { Circle, RectangleHorizontal, Square } from "lucide-react";
import {
    buildInvert, invertToDxf, invertToFds, invertToSvg, readInvertFile
} from "../lib/invert";
import type { FrameShape, MirrorAxis } from "../lib/invert";
import { AUTO_ARCH_HEIGHT, GRIP, HANDLES, autoLayers, autoSize, buildStampKit } from "../lib/stamp";
import type { HandleType } from "../lib/stamp";
import type { DesignDoc } from "../lib/design";
import { PanelSection } from "../workspace/PanelSection";
import { Preview } from "../workspace/Preview";
import { Workspace } from "../workspace/Workspace";
import { PairField, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useDocumentSource } from "../workspace/hooks/useDocumentSource";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import { MATERIALS, MaterialSection } from "../workspace/MaterialSection";
import type { MaterialId } from "../workspace/MaterialSection";
import { WidthField } from "../workspace/WidthField";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Stamp creator.
//
// The tool is unchanged — buildInvert and buildStampKit do exactly what they
// did. What changed is where its eleven controls live. They used to be a
// two-column grid *below* a 480 px preview, so setting a margin meant nudging a
// slider you could see and watching a result you could not. Now every one of
// them is beside the drawing, grouped by what it is about:
//
//   Plate     — the shape and size of the thing being cut
//   Laser     — the two properties about it *being a stamp*: which way round it
//               prints, and whether the plate is freed from the sheet
//   Handle    — what you hold it by, and therefore what else gets cut
//   Material  — what that is cut from, which is what decides the layer count
//   Source    — only ever shown for an SVG that did not state its own size
//
// The parts sheet is a second drawing, not a property, so it is a tab under the
// stage with a preview of its own rather than a list of numbers in the panel.
// ---------------------------------------------------------------------------

const MARGIN_MAX = 60;
const RADIUS_MAX = 40;

/** How far the artwork may be nudged inside its plate, mm. */
const OFFSET_MAX = 40;

/** Mirrors GRIP_HEIGHT in lib/stamp.ts — what the layer count aims at. */
const GRIP_TARGET = 20;

interface StampParams {
    frame: FrameShape;
    /** the finished stamp is a size you name, rather than one the design decides */
    sized: boolean;
    sizeW: number;
    /** 0 = follow the design's own proportions at the width above */
    sizeH: number;
    margin: number;
    radius: number;
    mirror: MirrorAxis;
    cut: boolean;
    /** nudge the artwork inside the plate, mm */
    offsetX: number;
    offsetY: number;
    handle: HandleType;
    /** layers in the glued stack; 0 = what this sheet needs for a 20 mm grip */
    gripLayers: number;
    /** disc diameter or bar length in mm; 0 = the handle type's own default */
    gripSize: number;
    /** the arch's upright height in mm; 0 = its own default */
    archHeight: number;
    /** width in mm for an SVG that stated no physical size; 0 = use the guess */
    widthOverride: number;
    material: MaterialId;
    thickness: number;
}

const DEFAULTS: StampParams = {
    frame: "rect",
    // A stamp is a thing you order at a size, not a thing whose size you
    // discover — "a 40 × 15 mm stamp" is how people describe one, and "a design
    // plus 3 mm" is not. So naming the size is the default, at the commonest
    // one, and the design is scaled to fit it.
    sized: true,
    sizeW: 50,
    sizeH: 0,
    margin: 3,
    radius: 0,
    mirror: "none",
    offsetX: 0,
    offsetY: 0,
    // A stamp face has to come off the sheet, so the same file may as well free
    // it: the plate's edge goes out a second time in cutting red.
    cut: true,
    handle: "discs",
    gripLayers: 0,
    gripSize: 0,
    archHeight: 0,
    widthOverride: 0,
    material: "rubber",
    thickness: 3
};

// Settings that belong to the open file rather than to the workshop. The height
// is one of them because it follows the design's proportions; the width is not,
// because "my stamps are 50 mm wide" is a fact about the person, not the file.
const TRANSIENT: (keyof StampParams)[] = ["sizeH", "widthOverride", "offsetX", "offsetY"];

const FRAMES = [
    { id: "rect" as const, label: "Rect", icon: <Square className="size-3" />, hint: "The design's bounding box grown by the margin. Round the corners to match a stamp mount." },
    { id: "ellipse" as const, label: "Oval", icon: <RectangleHorizontal className="size-3" />, hint: "An ellipse of the design's own proportions, passing through the corners of its bounding box — so a wide design gets a wide oval." },
    { id: "circle" as const, label: "Circle", icon: <Circle className="size-3" />, hint: "A circle reaching the far corner of the design's bounding box. What a round stamp needs." }
];

const MIRRORS = [
    { id: "none" as const, label: "As drawn" },
    { id: "h" as const, label: "Mirror ↔" },
    { id: "v" as const, label: "Mirror ↕" }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;
/** Sizes are typed in tenths of a millimetre; nothing here is finer than that. */
const r1 = (n: number): number => Math.round(n * 10) / 10;

export default function StampTool() {
    const params = useHistoryParams<StampParams>(DEFAULTS, {
        storageKey: "laserkit:params:stamp",
        transient: TRANSIENT
    });
    const p = params.value;

    const onOpen = params.resetTransient;
    const source = useDocumentSource<DesignDoc>({
        read: readInvertFile,
        fallbackError: "This file could not be read. Drop an .svg, or an .xcs / .xs project saved by xTool Creative Space or xTool Studio.",
        event: "invert_file",
        acceptHandoff: true,
        onOpen
    });
    const doc = source.doc;

    // The height a named width implies, while none has been typed over it: the
    // plate the design would have had, scaled to that width. Derived rather than
    // stored, so opening a taller design cannot silently keep the last one's
    // proportions.
    const naturalH = doc && doc.width > 0
        ? r1((p.sizeW * (doc.height + 2 * p.margin)) / (doc.width + 2 * p.margin))
        : p.sizeW;
    const sizeH = p.sizeH || naturalH;

    // The builder is pinned to the settings it reads, so the debounced effect
    // re-runs when one of them moves and not when anything else re-renders.
    const build = useCallback((d: DesignDoc) => buildInvert(d, {
        frame: p.frame,
        size: p.sized ? { w: p.sizeW, h: sizeH } : null,
        margin: p.margin,
        radius: p.radius,
        mirror: p.mirror,
        offset: { x: p.offsetX, y: p.offsetY },
        cut: p.cut,
        scale: p.widthOverride && d.width > 0 ? p.widthOverride / d.width : 1
    }), [p.frame, p.sized, p.sizeW, sizeH, p.margin, p.radius, p.mirror, p.offsetX, p.offsetY, p.cut, p.widthOverride]);

    // A new file, canvas, scale, plate shape or named size is a different drawing
    // at a very different size — a circle around a wide design is more than twice
    // as tall as the rectangle was, and a stamp retyped from 50 mm to 150 mm is
    // three times the object. Each of those refits the view, so what you just
    // asked for is what fills the canvas.
    //
    // The margin deliberately does not: nudging it is an adjustment to the
    // drawing already in front of you, and the view must stay where you put it.
    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: doc,
        build,
        fitKey: `${source.name}|${source.tab}|${p.widthOverride}|${p.frame}|${p.sized}|${p.sizeW}|${sizeH}`,
        fallbackError: "Inverting failed."
    });

    // The parts around the stamp follow from the plate alone, so they are cheap
    // to keep in step with it.
    // The handle's numbers follow the sheet and the stamp until they are typed
    // over — 0 means "whatever you worked out", the same way the stamp's own
    // height does. Derived here so the sliders show the effective value rather
    // than a zero nobody could interpret.
    const bStack = p.handle === "discs" || p.handle === "knob",
        gripLayers = p.gripLayers || autoLayers(p.thickness),
        gripSize = p.gripSize || autoSize(p.handle, result?.width ?? 0),
        archHeight = p.archHeight || AUTO_ARCH_HEIGHT;

    const kit = useMemo(
        () => (result
            ? buildStampKit(result.spec, {
                handle: p.handle,
                thickness: p.thickness,
                layers: gripLayers,
                size: gripSize,
                height: archHeight
            })
            : null),
        [result, p.handle, p.thickness, gripLayers, gripSize, archHeight]
    );

    const stem = `${source.name}${source.aDoc && source.aDoc.length > 1 && doc ? "_" + doc.title.replaceAll(" ", "_") : ""}`;

    const exports: ExportItem[] = useMemo(() => {
        if (!result) return [];
        return [
            ...designExports({
                stem: `${stem}_inverted`,
                eventPrefix: "INVERT",
                build: fmt => fmt === "fds"
                    ? invertToFds(result)
                    : textBlob(fmt === "dxf" ? invertToDxf(result) : invertToSvg(result), fmt)
            }),
            ...(kit && kit.aPart.length > 1 ? [{
                id: "parts",
                label: "Stamp parts sheet",
                desc: `${kit.aPart.map(o => o.label).join(", ")} — one SVG of ${mm(kit.width)} × ${mm(kit.height)}, cut to this stamp's own outline`,
                filename: `${stem}_stamp_parts.svg`,
                blob: () => textBlob(kit.svg, "svg"),
                event: "STAMP_PARTS_Download",
                group: "extra" as const
            }] : [])
        ];
    }, [result, kit, stem]);

    const legend: LegendItem[] = [
        { color: "#1e6bff", label: "engraved away" },
        { color: "#ffffff", label: "left standing", outlined: true },
        ...(p.cut ? [{ color: "#ff0000", label: "cut line" }] : [])
    ];

    const bCircle = p.frame === "circle";

    return (
        <Workspace
            toolId="stamp"
            subject="Stamp"
            subtitle={result ? `${mm(result.width)} × ${mm(result.height)}` : undefined}
            documentName={source.name}
            from={source.from}
            tabs={(source.aDoc ?? []).map((o, i) => ({ id: `${i}-${o.title}`, label: o.title }))}
            tab={source.tab}
            onTab={source.setTab}
            empty={source.empty}
            busy={source.busy}
            error={source.error ?? error}
            onOpenFile={source.open}
            onClose={source.close}
            params={params}
            stage={{ svg: result?.preview ?? "", fitKey, pending }}
            legend={legend}
            stats={result ? [
                { label: "Size", value: `${mm(result.width)} × ${mm(result.height)}` },
                { label: "Shapes kept", value: String(result.shapes) },
                { label: "Engraved", value: `${Math.round(result.engraved * 100)} %` },
                { label: "Points", value: String(result.points) }
            ] : []}
            warnings={[...(result?.warnings ?? []), ...(kit?.warnings ?? [])]}
            exports={exports}
            sendTo={{
                name: `${stem}_inverted`,
                svg: () => (result ? invertToSvg(result) : ""),
                disabled: !result
            }}
            bottomPanels={kit && kit.aPart.length > 1 ? [{
                id: "parts",
                title: "Handle & parts",
                // Open on arrival: the sheet is half of what this tool makes,
                // and a stamp face nobody can hold is not a finished job.
                defaultOpen: true,
                children: (
                    <div className="grid h-full gap-3 lg:grid-cols-[1fr_18rem]">
                        <Preview
                            svg={kit.svg}
                            // The sheet is re-nested whenever the handle or the
                            // layer count changes, so the view refits to it.
                            fitKey={`${stem}|${p.handle}|${kit.aPart.length}|${kit.width}|${kit.height}`}
                            subject="parts sheet"
                            className="min-h-56"
                            data-testid="parts-preview"
                        />
                        <div className="space-y-2">
                            <p className="text-[11px] leading-relaxed text-subtle-foreground">
                                One sheet of {mm(kit.width)} × {mm(kit.height)}, cut to this stamp's own outline —
                                cut lines in red, the handle's glue position in engraving green. Export →{" "}
                                <span className="text-muted-foreground">Stamp parts sheet</span>.
                            </p>
                            <ul className="space-y-1.5">
                                {kit.aPart.map(o => (
                                    <li key={o.label} className="text-[11px] leading-snug text-subtle-foreground">
                                        <span className="text-muted-foreground">{o.label}</span> — {o.note}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )
            }] : undefined}
        >
            {/* ── Plate ──────────────────────────────────────────────────── */}
            <PanelSection id="stamp-plate" title="Plate">
                <SegmentedField
                    label="Shape"
                    hint={FRAMES.find(o => o.id === p.frame)!.hint}
                    value={p.frame}
                    choices={FRAMES}
                    onChange={v => params.set({ frame: v }, { label: "Plate shape" })}
                />

                <ToggleField
                    label="Set the size"
                    hint={p.sized
                        ? "The finished stamp comes out exactly this big and the design is scaled to fit inside it, keeping the margin and its own proportions. Retyping it refits the canvas, so the new size is what you see."
                        : `Off, the design decides: the plate is what the shape makes of its bounding box. Turn this on to name the size instead — it starts from the ${result ? mm(result.width) + " × " + mm(result.height) : "size"} it has now.`}
                    checked={p.sized}
                    onChange={b => params.set(
                        b
                            ? { sized: true, ...(result ? { sizeW: r1(result.width), sizeH: r1(result.height) } : {}) }
                            : { sized: false },
                        { label: "Stamp size" }
                    )}
                />

                {p.sized && (
                    <PairField
                        label={bCircle ? "Diameter" : "Width × height"}
                        hint={p.sizeH
                            ? "Both named outright. Clear the height and it goes back to following the design's own proportions."
                            : "The height follows the design's proportions until you type one over it."}
                        w={p.sizeW}
                        h={sizeH}
                        locked={bCircle}
                        onW={n => params.set(
                            { sizeW: n, sizeH: bCircle ? n : p.sizeH },
                            { label: "Stamp size", coalesce: "size" }
                        )}
                        onH={n => params.set({ sizeH: n }, { label: "Stamp size", coalesce: "size" })}
                    />
                )}

                <SliderField
                    label="Margin"
                    hint={p.sized
                        ? "The gap the design keeps from the plate's edge — with the size fixed, raising this shrinks the artwork rather than the plate."
                        : `How much plate stands around the design. ${FRAMES.find(o => o.id === p.frame)!.hint}`}
                    value={p.margin}
                    min={0}
                    max={MARGIN_MAX}
                    onChange={n => params.set({ margin: n }, { label: "Margin", coalesce: "margin" })}
                />

                <SliderField
                    label="Move across"
                    hint="The plate is built around the artwork's bounding box, and a box is not what the eye centres on — a motif with a tail or a flourish reads as crooked at dead centre. This moves the artwork; the plate stays put."
                    value={p.offsetX}
                    min={-OFFSET_MAX}
                    max={OFFSET_MAX}
                    step={0.1}
                    onChange={n => params.set({ offsetX: n }, { label: "Move the artwork", coalesce: "offsetX" })}
                />
                <SliderField
                    label="Move down"
                    hint="The same, vertically. Positive moves it down the plate."
                    value={p.offsetY}
                    min={-OFFSET_MAX}
                    max={OFFSET_MAX}
                    step={0.1}
                    onChange={n => params.set({ offsetY: n }, { label: "Move the artwork", coalesce: "offsetY" })}
                />
                {(p.offsetX !== 0 || p.offsetY !== 0) && (
                    <button
                        onClick={() => params.set({ offsetX: 0, offsetY: 0 }, { label: "Recentre the artwork" })}
                        className="text-[11px] text-accent/80 underline decoration-accent/40 underline-offset-2 transition-colors hover:text-accent"
                    >
                        back to the middle
                    </button>
                )}

                {p.frame === "rect" && (
                    <SliderField
                        label="Corner radius"
                        hint="Rounded corners are capped at half the shorter side, and they bite into the margin — if a shape ends up outside the plate, give it more room."
                        value={p.radius}
                        min={0}
                        max={RADIUS_MAX}
                        onChange={n => params.set({ radius: n }, { label: "Corner radius", coalesce: "radius" })}
                    />
                )}
            </PanelSection>

            {/* ── What the laser does with it ────────────────────────────── */}
            <PanelSection id="stamp-laser" title="Laser">
                <SelectField
                    label="Orientation"
                    hint="A stamp prints back-to-front, so it has to be engraved mirrored. The design flips about its own centre; the plate stays where it is."
                    value={p.mirror}
                    choices={MIRRORS}
                    onChange={v => params.set({ mirror: v }, { label: "Mirroring" })}
                />
                <ToggleField
                    label="Cut the plate out"
                    hint="Adds the plate's edge a second time, in cutting red, so the same file both engraves the background and frees the piece from the sheet."
                    checked={p.cut}
                    onChange={b => params.set({ cut: b }, { label: "Cut the plate out" })}
                />
                {/* What is engraved and what is left standing is named in the
                    legend on the canvas; repeating it here made two lists of the
                    same thing. */}
            </PanelSection>

            {/* ── What you hold it by ────────────────────────────────────── */}
            <PanelSection id="stamp-handle" title="Handle">
                <SelectField
                    label="Type"
                    hint={HANDLES.find(o => o.id === p.handle)!.hint}
                    value={p.handle}
                    choices={HANDLES}
                    onChange={v => params.set({ handle: v }, { label: "Handle" })}
                />

                {p.handle !== "none" && (
                    <>
                        <SliderField
                            label={bStack ? "Diameter" : "Bar length"}
                            hint={bStack
                                ? "Across the widest disc. The knob's top disc is graded down from it."
                                : "The bar you actually hold. It starts at 70 % of the stamp's width, which is what stops it overhanging a short plate."}
                            value={gripSize}
                            min={GRIP.minSize}
                            max={GRIP.maxSize}
                            onChange={n => params.set({ gripSize: n }, { label: "Handle size", coalesce: "gripSize" })}
                        />

                        {bStack ? (
                            <SliderField
                                label="Layers"
                                hint={`How many discs are glued into the stack. It starts at whatever this sheet needs for a ${GRIP_TARGET} mm grip — ${autoLayers(p.thickness)} of ${mm(p.thickness)} — and the height below follows whatever you set.`}
                                value={gripLayers}
                                min={GRIP.minLayers}
                                max={GRIP.maxLayers}
                                step={1}
                                unit=""
                                onChange={n => params.set({ gripLayers: n }, { label: "Handle layers", coalesce: "gripLayers" })}
                            />
                        ) : (
                            <SliderField
                                label="Upright height"
                                hint="How far your fingers clear the paper. Unlike a glued stack this is cut, not counted, so the sheet thickness does not bound it."
                                value={archHeight}
                                min={GRIP.minHeight}
                                max={GRIP.maxHeight}
                                onChange={n => params.set({ archHeight: n }, { label: "Upright height", coalesce: "archHeight" })}
                            />
                        )}

                        {kit && (
                            <p className="text-[11px] leading-relaxed text-subtle-foreground">
                                {kit.layers > 0
                                    ? `${kit.layers} layers × ${mm(p.thickness)} = ${mm(kit.handleHeight)} of grip.`
                                    : `${mm(kit.handleHeight)} of clearance under the bar.`}{" "}
                                The sheet is in the <span className="text-muted-foreground">Handle &amp; parts</span>{" "}
                                tab below the canvas.
                            </p>
                        )}
                    </>
                )}
            </PanelSection>

            {/* ── Material ───────────────────────────────────────────────── */}
            <MaterialSection
                material={p.material}
                thickness={p.thickness}
                onMaterial={v => params.set({ material: v }, { label: "Material" })}
                onThickness={n => params.set({ thickness: n }, { label: "Thickness", coalesce: "thickness" })}
                notes={kit && kit.layers > 0
                    ? [`A ${mm(GRIP_TARGET)} grip takes ${kit.layers} layers of this sheet — ${mm(kit.handleHeight)} glued up.`]
                    : undefined}
                footer={p.material === "rubber"
                    ? "Laser-engraved rubber needs enough removed that the background cannot touch the paper — a fill at high power with several passes, or a defocused pass. Cut a test tile first. The handle wants plywood or acrylic instead."
                    : `${MATERIALS.find(o => o.id === p.material)!.label} makes the base plate and the handle; the engraved face itself wants rubber.`}
            />

            {/* ── Only ever shown for an SVG with no size of its own ─────── */}
            {doc?.assumed && (
                <WidthField
                    value={p.widthOverride}
                    guess={doc.width}
                    because="The margin is in real millimetres, so the whole plate depends on it."
                    onChange={n => params.set({ widthOverride: n }, { label: "Design width", coalesce: "width" })}
                />
            )}
        </Workspace>
    );
}
