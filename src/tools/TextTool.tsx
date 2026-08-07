import { useCallback, useEffect, useMemo, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, KeyRound, Type } from "lucide-react";
import { availableFonts, isFontFile, loadFontFile } from "../lib/fonts";
import type { FontChoice } from "../lib/fonts";
import { buildTextDesign, textToDxf, textToFds, textToSvg } from "../lib/text";
import type { LetterMode, RingEdge, TextAlign, TextOptions } from "../lib/text";
import type { ConnectMode } from "../lib/outline";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { Field, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";
import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// Text generator.
//
// The only tool with no file to open: the document *is* the text, so the
// toolbar's Open loads a typeface rather than a design, and the stage is empty
// until something is typed rather than until something is dropped.
//
// Its panels follow the order the thing is actually made in:
//
//   Text      — what it says, in what face, how big
//   Spacing   — how tightly it is set
//   Outline   — how faithfully the glyphs are fitted. Not buried under an
//               "advanced" heading: it is the difference between a typeface
//               people recognise and one that has been rounded off, so it sits
//               with the type rather than behind a disclosure triangle.
//   Plate     — whether the letters get welded into something to cut around
//   Keyring   — the hole, and where on the plate it goes
//   Laser     — what the beam does with the letters themselves
// ---------------------------------------------------------------------------

const SPACING_MIN = -5;
const SPACING_MAX = 20;
const BORDER_MAX = 40;
const REACH_MAX = 60;

interface TextParams extends TextOptions {}

const DEFAULTS: TextParams = {
    text: "LaserKit",
    fontFamily: "sans-serif",
    bold: true,
    italic: false,
    capHeight: 20,
    letterSpacing: 0,
    wordSpacing: 0,
    lineHeight: 1.4,
    align: "center",
    // Type is not a photograph, and it is the one thing people recognise
    // instantly: round the corner off an Arial stem and it stops being Arial.
    // The tracer's own defaults are tuned for a rasterised photo edge that
    // *should* become a curve, so both start at 0 here — the outline follows
    // the glyph, vertex for vertex, and nothing is fitted across a corner.
    // Raise them for a face whose bowls come out visibly faceted.
    smooth: 0,
    simplify: 0,

    // A keychain is what people come to a text cutter for, so it is what the
    // tool opens as: letters welded into one plate with a hole in it.
    plate: true,
    border: 2.5,
    connect: true,
    connectMode: "wrap",
    reach: 0,

    letters: "engrave",
    letterEdges: false,

    ring: true,
    ringDiameter: 4,
    ringEdge: "left",
    ringOffset: 50,
    ringInset: 5,
    ringWall: 2.5
};

/** The text belongs to this job; everything else is how this workshop works. */
const TRANSIENT: (keyof TextParams)[] = ["text"];

const ALIGNS = [
    { id: "left" as const, label: "", srLabel: "Align left", icon: <AlignLeft className="size-3.5" />, hint: "Ragged right" },
    { id: "center" as const, label: "", srLabel: "Align centre", icon: <AlignCenter className="size-3.5" />, hint: "Centred" },
    { id: "right" as const, label: "", srLabel: "Align right", icon: <AlignRight className="size-3.5" />, hint: "Ragged left" }
];

const LETTERS = [
    { id: "engrave" as const, label: "Engrave", hint: "The letters are burnt into the plate — the usual for a name tag." },
    { id: "cut" as const, label: "Cut", hint: "The letters are cut out of the plate, leaving holes. A stencil." },
    { id: "none" as const, label: "None", hint: "No letter geometry at all: the plate's own outline is the product, which is what free-standing letters are." }
];

const EDGES = [
    { id: "left" as const, label: "Left" },
    { id: "right" as const, label: "Right" },
    { id: "top" as const, label: "Top" },
    { id: "bottom" as const, label: "Bottom" }
];

const CONNECT_MODES = [
    { id: "wrap" as const, label: "Shrink-wrap", hint: "One smooth outline sweeping from letter to letter, hugging each of them. Reach is how far it bridges." },
    { id: "bridge" as const, label: "Bridges", hint: "Each letter keeps its own shape, joined by a 4 mm neck along the shortest route." },
    { id: "hull" as const, label: "Taut band", hint: "The convex hull of the whole word: the shape a rubber band would take around it." }
];

const PRESETS: Preset<TextParams>[] = [
    {
        id: "keychain",
        label: "Keychain",
        hint: "Welded plate, engraved letters, a 4 mm hole on the left",
        patch: { plate: true, connect: true, connectMode: "wrap", border: 2.5, letters: "engrave", ring: true, ringDiameter: 4, ringWall: 2.5 }
    },
    {
        id: "standing",
        label: "Free-standing letters",
        hint: "Cut the word out as one piece — no plate around it, no hole",
        patch: { plate: true, connect: true, connectMode: "wrap", border: 0.6, letters: "none", ring: false }
    },
    {
        id: "stencil",
        label: "Stencil",
        hint: "A taut-band plate with the letters cut clean out of it",
        patch: { plate: true, connect: true, connectMode: "hull", border: 6, letters: "cut", ring: false }
    },
    {
        id: "engraveonly",
        label: "Engrave only",
        hint: "Just the lettering, to burn onto something you already have",
        patch: { plate: false, letters: "engrave", ring: false }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

export default function TextTool() {
    const params = useHistoryParams<TextParams>(DEFAULTS, {
        // Bumped with the tracing defaults below: these settings persist, so a
        // browser that met the tool while they were 1 / 0.4 would otherwise keep
        // the rounded-off letterforms for ever.
        storageKey: "laserkit:params:text.2",
        transient: TRANSIENT
    });
    const p = params.value;

    // Fonts are probed on the client only — the island is `client:only`, but the
    // probe still wants a paint to have happened before it measures.
    const [aFont, setFonts] = useState<FontChoice[]>([]);
    const [error, setError] = useState<string | null>(null);
    /** bumped when a font finishes loading, so the build re-runs with it */
    const [fontEpoch, setEpoch] = useState(0);

    useEffect(() => { setFonts(availableFonts()); }, []);

    // A family the browser has not finished loading measures as the fallback, so
    // the trace would be of the wrong typeface. Wait for it, then rebuild.
    useEffect(() => {
        let bStale = false;
        void document.fonts.load(`700 100px ${p.fontFamily}`)
            .catch(() => undefined)
            .then(() => { if (!bStale) setEpoch(n => n + 1); });
        return () => { bStale = true; };
    }, [p.fontFamily]);

    const openFont = useCallback((file: File) => {
        if (!isFontFile(file)) {
            setError(`${file.name} is not a font file — TTF, OTF, WOFF and WOFF2 all work.`);
            return;
        }
        setError(null);
        void loadFontFile(file)
            .then(o => {
                setFonts(a => (a.some(f => f.id === o.id) ? a : [...a, o]));
                params.set({ fontFamily: o.id }, { label: "Font" });
                setEpoch(n => n + 1);
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "This font could not be read."));
    }, [params]);

    // The whole settings object is the input, plus the font epoch so a typeface
    // arriving late re-runs the trace it would otherwise have missed.
    const input = useMemo(() => ({ ...p, epoch: fontEpoch }), [p, fontEpoch]);
    const build = useCallback((o: TextParams & { epoch: number }) => buildTextDesign(o), []);

    const { result, error: buildError, fitKey, pending } = useDebouncedBuild({
        input,
        build,
        // Everything that changes how big the piece is refits the view; the
        // letters' operation and the trace tolerances do not.
        fitKey: [
            p.text, p.fontFamily, p.bold, p.italic, p.capHeight, p.letterSpacing,
            p.wordSpacing, p.lineHeight, p.align, p.plate, p.border, p.connect,
            p.connectMode, p.reach, p.ring, p.ringDiameter, p.ringEdge, p.ringOffset,
            p.ringInset, p.ringWall
        ].join("|"),
        fallbackError: "This text could not be turned into geometry.",
        // Longer than the other tools': a plate offset over a whole word is the
        // most expensive build in the kit, so a shorter wait just queues work
        // the next keystroke throws away.
        delay: 120
    });

    const bEmpty = !p.text.trim(),
        stem = (p.text.split("\n")[0] || "text").trim().replace(/[^\w\-]+/g, "_").slice(0, 40) || "text";

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "TEXT",
        build: fmt => fmt === "fds"
            ? textToFds(result)
            : textBlob(fmt === "dxf" ? textToDxf(result) : textToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = result
        ? [
            ...(p.letters === "engrave" ? [{ color: "#1e6bff", label: "engraved" }] : []),
            ...(result.edges ? [{ color: "#00a000", label: "letter edges" }] : []),
            ...(p.plate || p.letters === "cut" || p.ring ? [{ color: "#ff0000", label: "cut line" }] : []),
            ...(p.plate ? [{ color: "#22d3ee", label: "plate" }] : [])
        ]
        : [];

    const bConnectable = p.plate && result != null && result.shapes > 1;

    // Dragging the hole on the canvas has to come back out as the same three
    // numbers the sliders set, or the two would disagree. The nearest edge wins,
    // and how far along it and how far in from it fall out of the drop point.
    const onDragRing = useCallback((q: { x: number; y: number }) => {
        const b = result?.ringBox;
        if (!b) return;
        const w = Math.max(0.001, b.x1 - b.x0),
            h = Math.max(0.001, b.y1 - b.y0),
            d: Record<RingEdge, number> = {
                left: q.x - b.x0, right: b.x1 - q.x, top: q.y - b.y0, bottom: b.y1 - q.y
            },
            edge = (Object.keys(d) as RingEdge[]).reduce((a, k) => (d[k] < d[a] ? k : a), "left" as RingEdge),
            along = edge === "left" || edge === "right" ? (q.y - b.y0) / h : (q.x - b.x0) / w,
            clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

        params.set({
            ringEdge: edge,
            ringOffset: Math.round(clamp(along * 100, 0, 100)),
            ringInset: Math.round(clamp(d[edge], 0, 40) * 10) / 10
        }, { label: "Ring position", coalesce: "ringDrag" });
    }, [result?.ringBox, params]);

    return (
        <Workspace
            toolId="text"
            subject="Text"
            subtitle={result ? `${mm(result.width)} × ${mm(result.height)}` : undefined}
            documentName={bEmpty ? "" : p.text.split("\n")[0]!.slice(0, 32)}
            from={null}
            tabs={[]}
            tab={0}
            onTab={() => undefined}
            empty={bEmpty}
            // The panel stays live with nothing on the stage: it is where the
            // text is typed, so emptying it would leave no way back in.
            inspectorEmpty={false}
            busy={false}
            error={error ?? buildError}
            onOpenFile={openFont}
            onClose={() => params.set({ text: "" }, { label: "Clear the text" })}
            params={params}
            stage={{
                svg: result?.preview ?? "",
                fitKey,
                pending,
                handle: p.ring && result?.ring
                    ? { ...result.ring, label: "Drag the keyring hole", onMove: onDragRing }
                    : undefined
            }}
            legend={legend}
            stats={result ? [
                { label: "Size", value: `${mm(result.width)} × ${mm(result.height)}` },
                { label: "Shapes", value: String(result.shapes) },
                { label: "Cut lines", value: String(result.pieces) },
                {
                    label: "Accuracy",
                    value: `± ${result.accuracy.toFixed(3)} mm`,
                    hint: "The glyphs are traced off a high-resolution render of the font rather than read out of it, so the outline is accurate to this rather than exactly."
                },
                { label: "Points", value: String(result.points) }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? textToSvg(result) : ""), disabled: !result }}
            emptyTitle="Type something in the panel on the right"
            emptySub="…or drop a font file here to set it in — TTF, OTF, WOFF and WOFF2 all work"
            sidebarBlocks={[{
                id: "text-presets",
                title: "Presets",
                children: (
                    <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
                )
            }]}
        >
            {/* ── What it says ───────────────────────────────────────────── */}
            <PanelSection id="text-text" title="Text" icon={<Type className="size-3" />}>
                <textarea
                    aria-label="Text"
                    rows={2}
                    spellCheck={false}
                    value={p.text}
                    onChange={e => params.set({ text: e.target.value }, { label: "Text", coalesce: "text" })}
                    placeholder="Type here…"
                    className={cn(
                        "w-full resize-y rounded-md border border-line-strong bg-panel-2 px-2 py-1.5",
                        "text-xs text-foreground outline-none transition-colors",
                        "placeholder:text-subtle-foreground hover:border-accent/40 focus:border-accent/60"
                    )}
                />

                <SelectField
                    label="Font"
                    hint="Every typeface installed on this machine that the browser will admit to, plus any you drop on the canvas. The glyphs are traced off a render of the font, so ligatures and kerning are the browser's own."
                    value={p.fontFamily}
                    choices={aFont.map(o => ({ id: o.id, label: o.loaded ? `${o.label} · loaded` : o.label }))}
                    onChange={v => params.set({ fontFamily: v }, { label: "Font" })}
                />

                <Field label="Style">
                    <div className="flex gap-1">
                        <button
                            aria-label="Bold"
                            aria-pressed={p.bold}
                            onClick={() => params.set({ bold: !p.bold }, { label: "Bold" })}
                            className={cn(
                                "flex h-7 flex-1 items-center justify-center rounded-md text-xs transition-colors",
                                p.bold ? "bg-elevated text-foreground" : "bg-panel-2 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Bold className="size-3.5" />
                        </button>
                        <button
                            aria-label="Italic"
                            aria-pressed={p.italic}
                            onClick={() => params.set({ italic: !p.italic }, { label: "Italic" })}
                            className={cn(
                                "flex h-7 flex-1 items-center justify-center rounded-md text-xs transition-colors",
                                p.italic ? "bg-elevated text-foreground" : "bg-panel-2 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Italic className="size-3.5" />
                        </button>
                    </div>
                </Field>

                <SegmentedField
                    label="Alignment"
                    value={p.align}
                    choices={ALIGNS}
                    onChange={(v: TextAlign) => params.set({ align: v }, { label: "Alignment" })}
                />

                <SliderField
                    label="Cap height"
                    hint="How tall a capital comes out. Not the font size — a font's em is bigger than its capitals by an amount that differs per typeface, so this is the number you can hold a ruler against."
                    value={p.capHeight}
                    min={3}
                    max={120}
                    onChange={n => params.set({ capHeight: n }, { label: "Cap height", coalesce: "capHeight" })}
                />
            </PanelSection>

            {/* ── The gaps between them ──────────────────────────────────── */}
            <PanelSection id="text-spacing" title="Spacing">
                <SliderField
                    label="Letters"
                    hint="Added between every pair of letters. Widen it to keep them from welding into each other when the plate's border grows; tighten it to make a word one piece with less border."
                    value={p.letterSpacing}
                    min={SPACING_MIN}
                    max={SPACING_MAX}
                    step={0.1}
                    onChange={n => params.set({ letterSpacing: n }, { label: "Letter spacing", coalesce: "letterSpacing" })}
                />
                <SliderField
                    label="Words"
                    hint="Added to the space character on top of the letter spacing."
                    value={p.wordSpacing}
                    min={0}
                    max={SPACING_MAX}
                    step={0.1}
                    onChange={n => params.set({ wordSpacing: n }, { label: "Word spacing", coalesce: "wordSpacing" })}
                />
                {p.text.includes("\n") && (
                    <SliderField
                        label="Lines"
                        hint="Line pitch as a multiple of the cap height."
                        value={p.lineHeight}
                        min={0.8}
                        max={3}
                        step={0.05}
                        unit="×"
                        onChange={n => params.set({ lineHeight: n }, { label: "Line height", coalesce: "lineHeight" })}
                    />
                )}
            </PanelSection>

            {/* ── How faithfully the glyphs are fitted ───────────────────── */}
            <PanelSection id="text-outline" title="Outline">
                <SliderField
                    label="Smooth"
                    hint="How much of a bend may be rounded into a curve instead of kept as a corner. 0 follows the glyph vertex for vertex, which is what keeps a typeface recognisable — past about 0.5 it rounds the corners off the stems and melts the terminals. Raise it only if a bowl comes out visibly faceted."
                    value={p.smooth}
                    min={0}
                    max={1.334}
                    step={0.01}
                    unit=""
                    onChange={n => params.set({ smooth: n }, { label: "Smooth", coalesce: "smooth" })}
                />
                <SliderField
                    label="Simplify"
                    hint="How far a node may be moved to be rid of it, in render pixels. 0 keeps every one; the accuracy in the status bar is what raising it costs."
                    value={p.simplify}
                    min={0}
                    max={3}
                    step={0.05}
                    unit="px"
                    onChange={n => params.set({ simplify: n }, { label: "Simplify", coalesce: "simplify" })}
                />
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    The browser will not hand over a font's outlines, so the text is rendered large and traced. That is
                    why there is a tolerance at all, and why every font on this machine works without being uploaded.
                    The render is scaled to the glyph rather than to the millimetres, so a 6 mm keychain is fitted just
                    as finely as a 60 mm sign.
                </p>
            </PanelSection>

            {/* ── Welding it into something cuttable ─────────────────────── */}
            <PanelSection id="text-plate" title="Plate">
                <ToggleField
                    label="Backing plate"
                    hint="Traces a cut line around the letters. Without it the letters are all there is, which only holds together if they touch."
                    checked={p.plate}
                    onChange={b => params.set({ plate: b }, { label: "Backing plate" })}
                />

                {p.plate && (
                    <>
                        <SliderField
                            label="Border"
                            hint="Millimetres of plate around the letters. At 0 the cut line is the letters' own contour — which is what free-standing letters are, as long as they touch each other."
                            value={p.border}
                            min={0}
                            max={BORDER_MAX}
                            step={0.1}
                            onChange={n => params.set({ border: n }, { label: "Border", coalesce: "border" })}
                        />
                        <ToggleField
                            label="Join the letters"
                            hint="Letters that still stand apart after the border get welded together, so the word comes off the bed as one piece instead of a bag of loose shapes."
                            checked={p.connect}
                            disabled={!bConnectable}
                            onChange={b => params.set({ connect: b }, { label: "Join the letters" })}
                        />
                        {p.connect && bConnectable && (
                            <>
                                <SelectField
                                    label="Join by"
                                    hint={CONNECT_MODES.find(o => o.id === p.connectMode)!.hint}
                                    value={p.connectMode}
                                    choices={CONNECT_MODES}
                                    onChange={(v: ConnectMode) => params.set({ connectMode: v }, { label: "Join method" })}
                                />
                                {p.connectMode === "wrap" && (
                                    <SliderField
                                        label="Reach"
                                        hint={`How far the wrap bridges from letter to letter.${result?.autoReach ? ` The gaps here ask for about ${result.autoReach} mm.` : ""}`}
                                        value={p.reach || result?.autoReach || 1}
                                        min={0.5}
                                        max={REACH_MAX}
                                        onChange={n => params.set({ reach: n }, { label: "Reach", coalesce: "reach" })}
                                    />
                                )}
                            </>
                        )}
                    </>
                )}
            </PanelSection>

            {/* ── Hanging it off something ───────────────────────────────── */}
            <PanelSection id="text-ring" title="Keyring" icon={<KeyRound className="size-3" />}>
                <ToggleField
                    label="Keyring hole"
                    hint="Punches a hole to put a split ring through."
                    checked={p.ring}
                    onChange={b => params.set({ ring: b }, { label: "Keyring hole" })}
                />
                {p.ring && (
                    <>
                        <SliderField
                            label="Hole ⌀"
                            hint="Cut, so it comes out the size you ask for minus a kerf. A 4 mm hole takes the usual split ring; go to 5 mm for a carabiner."
                            value={p.ringDiameter}
                            min={1.5}
                            max={15}
                            step={0.1}
                            onChange={n => params.set({ ringDiameter: n }, { label: "Hole diameter", coalesce: "ringDiameter" })}
                        />
                        <SegmentedField
                            label="Edge"
                            hint="Which side of the plate it hangs from."
                            value={p.ringEdge}
                            choices={EDGES}
                            onChange={(v: RingEdge) => params.set({ ringEdge: v }, { label: "Ring edge" })}
                        />
                        <SliderField
                            label="Along the edge"
                            hint="0 % is the top or the left end of that edge, 100 % the other. 50 % centres it. Or drag the hole on the canvas — the edge, the position and the inset all follow it."
                            value={p.ringOffset}
                            min={0}
                            max={100}
                            step={1}
                            unit="%"
                            onChange={n => params.set({ ringOffset: n }, { label: "Ring position", coalesce: "ringOffset" })}
                        />
                        <SliderField
                            label="Inset"
                            hint="How far the hole's centre sits in from that edge. Too little and the hole breaks out of the plate — the status bar says so when it does."
                            value={p.ringInset}
                            min={0}
                            max={40}
                            step={0.1}
                            onChange={n => params.set({ ringInset: n }, { label: "Ring inset", coalesce: "ringInset" })}
                        />
                        <SliderField
                            label="Wall"
                            hint={p.plate
                                ? "Material kept around the hole. It is welded into the plate before the outline is traced, so a hole placed off the end of a word grows its own lug to sit in. 0 leaves the plate alone."
                                : "With no backing plate this is the tab itself — a hole needs something to go through, so the ring brings its own body. Move it onto the lettering and the two come off the bed as one piece."}
                            value={p.ringWall}
                            min={0}
                            max={15}
                            step={0.1}
                            onChange={n => params.set({ ringWall: n }, { label: "Ring wall", coalesce: "ringWall" })}
                        />
                    </>
                )}
            </PanelSection>

            {/* ── What the beam does ─────────────────────────────────────── */}
            <PanelSection id="text-laser" title="Laser">
                <SegmentedField
                    label="Letters"
                    hint={LETTERS.find(o => o.id === p.letters)!.hint}
                    value={p.letters}
                    choices={LETTERS}
                    onChange={(v: LetterMode) => params.set({ letters: v }, { label: "Letters" })}
                />
                <ToggleField
                    label="Engrave where letters overlap"
                    hint="Tighten the letters past touching and they merge into one silhouette — an “rn” becomes an “m”. This engraves the seam back in: every letter is traced apart, laid down left to right, and its edge burnt only where it laps over an earlier letter and is not itself covered by a later one. Line engraving, in green."
                    checked={p.letterEdges}
                    onChange={b => params.set({ letterEdges: b }, { label: "Letter edges" })}
                />
                {p.letterEdges && result && !result.edges && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        Nothing overlaps yet — tighten the letter spacing until the letters run into each other and
                        the seams appear.
                    </p>
                )}
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Engraved letters export as one even-odd path in surface-engraving blue, their edges as line
                    engraving in green; everything cut — the plate, the hole, and the letters when they are cut —
                    goes out in cutting red.
                </p>
            </PanelSection>

        </Workspace>
    );
}
