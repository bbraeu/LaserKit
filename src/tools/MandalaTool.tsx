import { useCallback, useMemo } from "react";
import { Dices, Flower, Ruler, Scissors } from "lucide-react";
import { MANDALA_LIMITS, buildMandala, mandalaToDxf, mandalaToFds, mandalaToSvg } from "../lib/mandala";
import type { MandalaMode, MandalaOptions, MandalaStyle } from "../lib/mandala";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { Field, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { NumberField } from "../workspace/fields/NumberField";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Mandala generator.
//
// Every control here moves the whole drawing, deliberately: a slider per ring
// would be more powerful and would produce worse mandalas. The one number that
// is not about taste is the web — the material between motifs — and on a cut
// mandala it decides whether the thing survives being picked up, so it is a
// status-bar figure rather than something to infer from the picture.
// ---------------------------------------------------------------------------

const L = MANDALA_LIMITS;

interface MandalaParams extends MandalaOptions {}

const DEFAULTS: MandalaParams = {
    size: 120,
    // Sixteen and four: enough repeats that the eye reads a pattern rather
    // than a count, and enough rings that the half-slot offset between them
    // shows.
    symmetry: 16,
    rings: 4,
    style: "mixed",
    gap: 0.3,
    ringGap: 2.5,
    hub: 0.14,
    hole: 0,
    ringLines: true,
    // Outlined, because that is what a mandala is: line work that is only
    // sometimes filled in afterwards. Solid blobs are the one thing that makes
    // a generated one look generated.
    outlined: true,
    nested: true,
    mode: "engrave",
    outline: true,
    seed: 1
};

const STYLES = [
    { id: "mixed" as const, label: "Mixed", hint: "A different motif per ring, picked from the seed, with a ring of dots dropped in now and then. The one that most looks like somebody designed it." },
    { id: "lotus" as const, label: "Lotus petals", hint: "Drawn out to a sharp point at each end. The shape most people picture when they hear “mandala”." },
    { id: "petal" as const, label: "Petals", hint: "A lens: widest in the middle, pointed at both ends." },
    { id: "drop" as const, label: "Drops", hint: "Narrow at the hub and round at the rim, like a flame." },
    { id: "diamond" as const, label: "Diamonds", hint: "Straight sides to a point either side. The one angular motif, and what makes a ring read as geometry rather than flowers." },
    { id: "dart" as const, label: "Darts", hint: "Triangles standing on the hub and widening to the rim — a sunburst when there is only one ring of them." },
    { id: "spoke" as const, label: "Spokes", hint: "Nearly parallel sides with rounded ends. The most open of the set, and the strongest when cut." },
    { id: "scallop" as const, label: "Scallops", hint: "Fat almost all the way out, so what is left between them is a thin rib. Handsome engraved, fragile cut." },
    { id: "dots" as const, label: "Dots", hint: "A ring of small circles instead of a band of shapes. On its own it is a bead ring; between two bands it is the punctuation that stops a mandala reading as concentric fences." },
    // ── the composed ones ───────────────────────────────────────────────
    //
    // Everything above is one curve, symmetric about its slot. These are
    // assemblies, which is why they can be shapes the first eight cannot reach.
    { id: "flower" as const, label: "Rosettes", hint: "Six petals round a middle — a whole little flower as one motif, rather than one petal repeated. The most ornate of the set." },
    { id: "star" as const, label: "Stars", hint: "Five points, the first aimed at the rim. Two radii instead of one, which is exactly what a petal shape cannot do." },
    { id: "arrow" as const, label: "Arrows", hint: "A shaft with a chevron head and a fletched tail. The only motif that points, so a ring of them reads as rotation." },
    { id: "paisley" as const, label: "Paisley", hint: "A boteh: round at the bottom, curling to a point, with a dot in the belly. Asymmetric on purpose — the shape that most looks drawn by hand." },
    { id: "crescent" as const, label: "Crescents", hint: "Moons, thick in the middle and tapering to a horn at each end. Reads as motion round the circle." },
    { id: "chevron" as const, label: "Chevrons", hint: "A plain V-bar with rounded corners. The running border every printed mandala has somewhere, and the most open of the composed set." },
    { id: "fret" as const, label: "Greek key", hint: "A line that turns four corners. Angular and architectural — one ring of it under a ring of rosettes is the classic pairing." }
];

const MODES = [
    { id: "engrave" as const, label: "Engrave", hint: "The motifs are burnt into a disc. Nothing can fall out and nothing is fragile — pick this unless you want light through it." },
    { id: "cut" as const, label: "Cut through", hint: "The motifs become holes: a suncatcher, a lampshade panel, a trivet. Everything then hangs off the material between them, which is the figure in the status bar." }
];

const PRESETS: Preset<MandalaParams>[] = [
    {
        id: "coaster",
        label: "Engraved coaster",
        hint: "A 100 mm disc, twelve-fold, three rings",
        patch: { size: 100, symmetry: 16, rings: 4, style: "mixed", mode: "engrave", gap: 0.3, hole: 0, ringLines: true, outlined: true, nested: true }
    },
    {
        id: "suncatcher",
        label: "Suncatcher",
        hint: "Cut through, wide webs, a hole to hang it by",
        patch: { size: 140, symmetry: 12, rings: 3, style: "spoke", mode: "cut", gap: 0.5, ringGap: 4, hole: 4, ringLines: false }
    },
    {
        id: "rosette",
        label: "Dense rosette",
        hint: "Twenty-four-fold, five rings — engraved only",
        patch: { size: 150, symmetry: 24, rings: 5, style: "lotus", mode: "engrave", gap: 0.25, ringGap: 2, ringLines: true, outlined: true, nested: true }
    },
    {
        id: "sunburst",
        label: "Sunburst",
        hint: "One ring of long spokes off a big hub",
        patch: { symmetry: 32, rings: 1, style: "dart", hub: 0.45, gap: 0.5, mode: "engrave", ringLines: false, outlined: true, nested: false }
    }
];

export default function MandalaTool() {
    const params = useHistoryParams<MandalaParams>(DEFAULTS, { storageKey: "laserkit:params:mandala" });
    const p = params.value;

    const build = useCallback((o: MandalaParams) => buildMandala(o), []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        // The disc is always the diameter asked for, so only that refits.
        fitKey: String(p.size),
        fallbackError: "This mandala could not be worked out."
    });

    const stem = useMemo(
        () => `mandala_${Math.round(p.size)}mm_${p.symmetry}x${p.rings}_${p.seed}`,
        [p.size, p.symmetry, p.rings, p.seed]
    );

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "MANDALA",
        build: fmt => fmt === "fds"
            ? mandalaToFds(result)
            : textBlob(fmt === "dxf" ? mandalaToDxf(result) : mandalaToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = p.mode === "cut"
        ? [{ color: "#ff0000", label: "cut" }]
        : [
            { color: "#1e6bff", label: "engraved" },
            ...(p.outline || p.hole > 0 ? [{ color: "#ff0000", label: "cut" }] : [])
        ];

    const bTight = result != null && p.mode === "cut" && result.web < 2;

    return (
        <Workspace
            toolId="mandala"
            subject="Mandala"
            subtitle={result ? `${p.symmetry}-fold · ${result.motifs} motifs` : undefined}
            documentName={result ? `Mandala ⌀ ${result.width.toFixed(0)} mm` : "Mandala"}
            from={null}
            tabs={[]}
            tab={0}
            onTab={() => undefined}
            empty={false}
            inspectorEmpty={false}
            openable={false}
            busy={false}
            error={error}
            onOpenFile={() => undefined}
            onClose={() => undefined}
            params={params}
            stage={{ svg: result?.preview ?? "", fitKey, pending }}
            legend={legend}
            stats={result ? [
                { label: "Diameter", value: `${result.width.toFixed(0)} mm` },
                { label: "Motifs", value: String(result.motifs) },
                { label: "Web", value: `${result.web.toFixed(2)} mm`, hint: "The narrowest material left between one motif and the next. Engraved it is a look; cut, it is the only thing holding the disc together — and nothing in the drawing shows you which side of “too thin” it is on." },
                { label: "Between rings", value: `${result.ringWeb.toFixed(1)} mm` }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? mandalaToSvg(result) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "mandala-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── The shape of it ────────────────────────────────────────── */}
            <PanelSection id="mandala-pattern" title="Pattern" icon={<Flower className="size-3" />}>
                <SelectField
                    label="Motif"
                    hint={STYLES.find(o => o.id === p.style)!.hint}
                    value={p.style}
                    choices={STYLES}
                    onChange={(v: MandalaStyle) => params.set({ style: v }, { label: "Motif" })}
                />
                <SliderField
                    label="Symmetry"
                    hint="How many times each ring repeats round the circle. Low numbers read as a flower, high ones as a sunburst — and every extra fold makes the material between the motifs narrower."
                    value={p.symmetry}
                    min={L.minSymmetry}
                    max={L.maxSymmetry}
                    step={1}
                    unit="×"
                    onChange={n => params.set({ symmetry: Math.round(n) }, { label: "Symmetry", coalesce: "symmetry" })}
                />
                <SliderField
                    label="Rings"
                    hint="Bands of pattern from the hub outwards. Every other one is turned half a slot, so they read as a weave rather than as spokes lining up all the way out."
                    value={p.rings}
                    min={L.minRings}
                    max={L.maxRings}
                    step={1}
                    unit=""
                    onChange={n => params.set({ rings: Math.round(n) }, { label: "Rings", coalesce: "rings" })}
                />
                <SliderField
                    label="Web"
                    hint="Share of each motif's slot left as material. Small values make a dense, lacy pattern; large ones make a sparse, strong one. This is the control that decides whether a cut mandala survives."
                    value={p.gap}
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    unit=""
                    onChange={n => params.set({ gap: n }, { label: "Web", coalesce: "gap" })}
                />
                {p.style === "mixed" && (
                    <Field
                        label="Seed"
                        hint="Which motif each ring gets. The same seed always gives the same mandala."
                        control={
                            <NumberField
                                label="Seed, exact value"
                                value={p.seed}
                                min={1}
                                max={999999}
                                unit=""
                                onChange={n => params.set({ seed: Math.max(1, Math.round(n)) }, { label: "Seed" })}
                            />
                        }
                    >
                        <button
                            onClick={() => params.set({ seed: 1 + Math.floor(Math.random() * 999998) }, { label: "Seed" })}
                            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-panel-2 text-xs text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
                        >
                            <Dices className="size-3.5" />
                            Another mandala
                        </button>
                    </Field>
                )}
            </PanelSection>

            {/* ── How big ────────────────────────────────────────────────── */}
            <PanelSection id="mandala-size" title="Disc" icon={<Ruler className="size-3" />}>
                <SliderField
                    label="Diameter"
                    hint="The whole disc. Everything else is a fraction of it, so the pattern is the same at any size — and the web in millimetres follows."
                    value={p.size}
                    min={L.minSize}
                    max={400}
                    onChange={n => params.set({ size: n }, { label: "Diameter", coalesce: "size" })}
                />
                <SliderField
                    label="Hub"
                    hint="The plain disc in the middle, as a share of the radius. It is what the rings hang off, and where a hanging hole goes."
                    value={p.hub}
                    min={0}
                    max={0.7}
                    step={0.01}
                    unit=""
                    onChange={n => params.set({ hub: n }, { label: "Hub", coalesce: "hub" })}
                />
                <SliderField
                    label="Between rings"
                    hint="Material between one ring of pattern and the next. On a cut mandala this is the second thing holding it together, after the web."
                    value={p.ringGap}
                    min={0}
                    max={20}
                    step={0.5}
                    onChange={n => params.set({ ringGap: n }, { label: "Between rings", coalesce: "ringGap" })}
                />
                <SliderField
                    label="Hanging hole"
                    hint="Punched through the hub. 0 for none."
                    value={p.hole}
                    min={0}
                    max={20}
                    step={0.5}
                    onChange={n => params.set({ hole: n }, { label: "Hanging hole", coalesce: "hole" })}
                />
            </PanelSection>

            {/* ── What the laser does ────────────────────────────────────── */}
            <PanelSection id="mandala-mode" title="Cutting" icon={<Scissors className="size-3" />}>
                <SegmentedField
                    label="The motifs"
                    hint={MODES.find(o => o.id === p.mode)!.hint}
                    value={p.mode}
                    choices={MODES}
                    onChange={(v: MandalaMode) => params.set({ mode: v }, { label: "The motifs" })}
                />
                <ToggleField
                    label="Outlines"
                    hint="Draw the motifs as lines rather than solid areas. This is what a mandala actually is — every one ever drawn is line work, outlined first and only sometimes filled in — and it is a fraction of the burn."
                    checked={p.outlined}
                    onChange={b => params.set({ outlined: b }, { label: "Outlines" })}
                />
                <ToggleField
                    label="Nested echo"
                    hint="A smaller copy of each motif inside itself. The other hallmark of a hand-drawn mandala — one echo turns a shape into a motif. Engraved only: a smaller hole inside a hole is a ring of material that falls out on its own."
                    checked={p.nested}
                    disabled={p.mode === "cut"}
                    onChange={b => params.set({ nested: b }, { label: "Nested echo" })}
                />
                <ToggleField
                    label="Ring lines"
                    hint="A thin engraved circle between one ring and the next. Nothing structural — it is the cheapest thing there is for making a set of repeated motifs read as one design rather than three unrelated ones. Always engraved, even on a cut mandala: cut, it would come away as a loose ring and take the pattern with it."
                    checked={p.ringLines}
                    onChange={b => params.set({ ringLines: b }, { label: "Ring lines" })}
                />
                <ToggleField
                    label="Cut the disc"
                    hint="Cuts the outer circle. Off leaves the pattern alone, to engrave onto something round you already have."
                    checked={p.outline}
                    onChange={b => params.set({ outline: b }, { label: "Cut the disc" })}
                />
                {p.mode === "cut" && result && (
                    <p className={`text-[11px] leading-relaxed ${bTight ? "text-amber-400" : "text-subtle-foreground"}`}>
                        {result.web.toFixed(2)} mm between motifs, {result.ringWeb.toFixed(1)} mm between rings. Those
                        two numbers are the whole structure — everything else is a hole.
                    </p>
                )}
            </PanelSection>
        </Workspace>
    );
}
