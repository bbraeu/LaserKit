import { useCallback, useMemo } from "react";
import { QrCode, Ruler, ShieldCheck } from "lucide-react";
import { QR_LIMITS, buildQr, qrToDxf, qrToFds, qrToSvg } from "../lib/qr";
import type { QrEcc, QrMode, QrOptions } from "../lib/qr";
import { cn } from "../lib/cn";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { Field, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// QR codes.
//
// The panel is short because the code is not really adjustable: what it carries
// decides how many modules there are, and everything else is how big to make
// them. The one control worth thinking about is the error correction, which is
// why it has the longest hint in the tool.
// ---------------------------------------------------------------------------

const L = QR_LIMITS;

interface QrParams extends QrOptions {}

const DEFAULTS: QrParams = {
    text: "https://bbraeu.github.io/LaserKit/",
    // Not L: an engraving gets scorched, chipped and worn, which is the exact
    // damage error correction exists for, and M costs very little.
    ecc: "M",
    mode: "engrave",
    size: 50,
    quiet: 4,
    trim: 0,
    outline: true,
    radius: 3
};

/** The text belongs to this job; the rest is how this workshop works. */
const TRANSIENT: (keyof QrParams)[] = ["text"];

const ECCS = [
    { id: "L" as const, label: "L — 7 %", hint: "The fewest modules, and the least tolerance for damage. For a code under glass that will never be touched." },
    { id: "M" as const, label: "M — 15 %", hint: "The sensible default. Recovers from a scorched corner or a chipped edge for a handful of extra modules." },
    { id: "Q" as const, label: "Q — 25 %", hint: "For something that will be handled, or engraved on a surface that is not flat." },
    { id: "H" as const, label: "H — 30 %", hint: "The most redundancy, and the most modules to cut. Worth it only when you expect real damage — or when you mean to cover part of the code with a logo." }
];

const MODES = [
    { id: "engrave" as const, label: "Engrave", hint: "The dark squares are burnt into the surface. What almost every code should be: the contrast comes from the burn, and nothing can fall out." },
    { id: "inlay" as const, label: "Cut for inlay", hint: "The dark squares are cut as loose tiles to drop into a light plate. There is no way to cut a QR code out of one piece — the middle of every finder pattern would fall on the floor — so this is the only cutting that works, and it is a lot of tiny pieces." }
];

const PRESETS: Preset<QrParams>[] = [
    {
        id: "tag",
        label: "Link on a tag",
        hint: "50 mm, engraved, medium correction",
        patch: { size: 50, ecc: "M", mode: "engrave", outline: true, radius: 3 }
    },
    {
        id: "tough",
        label: "Something that gets handled",
        hint: "High correction, a bigger plate",
        patch: { size: 80, ecc: "Q", mode: "engrave" }
    },
    {
        id: "sticker",
        label: "No plate",
        hint: "Just the code, to engrave on something you have",
        patch: { outline: false, mode: "engrave" }
    },
    {
        id: "inlay",
        label: "Inlay tiles",
        hint: "Cut the dark squares to drop into a light board",
        patch: { mode: "inlay", size: 120, ecc: "L", trim: 0.05 }
    }
];

export default function QrTool() {
    const params = useHistoryParams<QrParams>(DEFAULTS, {
        storageKey: "laserkit:params:qr",
        transient: TRANSIENT
    });
    const p = params.value;

    const build = useCallback((o: QrParams) => buildQr(o), []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        // The plate is always the size that was asked for, so only that refits.
        fitKey: [p.size, p.outline].join("|"),
        fallbackError: "This could not be made into a QR code.",
        delay: 80
    });

    const stem = useMemo(() => {
        const s = p.text.replace(/^https?:\/\//, "").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "");
        return `qr_${s.slice(0, 40) || "code"}`;
    }, [p.text]);

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "QR",
        build: fmt => fmt === "fds"
            ? qrToFds(result)
            : textBlob(fmt === "dxf" ? qrToDxf(result) : qrToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = [
        p.mode === "inlay" ? { color: "#ff0000", label: "tiles — cut" } : { color: "#1e6bff", label: "engraved" },
        ...(p.outline && p.mode === "engrave" ? [{ color: "#ff0000", label: "plate" }] : [])
    ];

    return (
        <Workspace
            toolId="qr"
            subject="QR code"
            subtitle={result ? `v${result.version} · ${result.modules} × ${result.modules}` : undefined}
            documentName={result ? `QR ${result.modules} × ${result.modules}` : "QR code"}
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
                { label: "Version", value: `${result.version}`, hint: "1 to 40. It is chosen for you: the version is the smallest one the data fits at the error correction you asked for." },
                { label: "Modules", value: `${result.modules} × ${result.modules}` },
                { label: "One module", value: `${result.moduleSize.toFixed(2)} mm`, hint: "The size of one square. This is the number that decides whether a phone can read it — under about 0.6 mm the beam's own width is a large fraction of a square." },
                { label: "Plate", value: `${result.width.toFixed(0)} × ${result.height.toFixed(0)} mm` },
                { label: "Shapes", value: `${result.rects} of ${result.dark}`, hint: "Runs of dark squares along a row are merged into one rectangle. Unmerged, the head would spend most of the job travelling between a thousand little squares." }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? qrToSvg(result) : ""), disabled: !result }}
            emptyTitle="Type what the code should carry"
            sidebarBlocks={[{
                id: "qr-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── What it carries ────────────────────────────────────────── */}
            <PanelSection id="qr-text" title="Content" icon={<QrCode className="size-3" />}>
                <textarea
                    aria-label="Content"
                    rows={3}
                    spellCheck={false}
                    value={p.text}
                    onChange={e => params.set({ text: e.target.value }, { label: "Content", coalesce: "text" })}
                    placeholder="A link, some text, a Wi-Fi string…"
                    className={cn(
                        "w-full resize-y rounded-md border border-line-strong bg-panel-2 px-2 py-1.5",
                        "text-xs text-foreground outline-none transition-colors",
                        "placeholder:text-subtle-foreground hover:border-accent/40 focus:border-accent/60"
                    )}
                />
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Anything a phone's camera should get back: a URL, a phone number, a note. Every character costs
                    modules, and modules are what have to stay big enough to read — a short link makes a code somebody
                    can actually catch.
                </p>
            </PanelSection>

            {/* ── How much damage it survives ────────────────────────────── */}
            <PanelSection id="qr-ecc" title="Correction" icon={<ShieldCheck className="size-3" />}>
                <SegmentedField
                    label="Error correction"
                    hint={ECCS.find(o => o.id === p.ecc)!.hint}
                    value={p.ecc}
                    choices={ECCS}
                    onChange={(v: QrEcc) => params.set({ ecc: v }, { label: "Error correction" })}
                />
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Not a quality setting — it is redundancy, and it costs modules. On engraved work the argument is
                    stronger than in print: a scorched corner, a chipped edge and a worn surface are exactly what it
                    recovers from.
                </p>
            </PanelSection>

            {/* ── How big ────────────────────────────────────────────────── */}
            <PanelSection id="qr-size" title="Size" icon={<Ruler className="size-3" />}>
                <SliderField
                    label="Plate"
                    hint="The whole square including the quiet border. The module size follows from this and from how much the code has to carry."
                    // The quiet border used to be a slider here and should never
                    // have been. The specification asks for four modules, every
                    // value below four made the tool complain, every value above
                    // four only wasted material, and all four presets set it to
                    // four — which is a control whose single correct position is
                    // its default. It is fixed at four now and folded into this
                    // size, which is what the label has always said it includes.
                    value={p.size}
                    min={L.minSize}
                    max={300}
                    onChange={n => params.set({ size: n }, { label: "Plate size", coalesce: "size" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        One module comes out{" "}
                        <span className={result.moduleSize < 0.6 ? "text-amber-400" : "text-muted-foreground"}>
                            {result.moduleSize.toFixed(2)} mm
                        </span>.
                    </p>
                )}
            </PanelSection>

            {/* ── What the laser does ────────────────────────────────────── */}
            <PanelSection id="qr-cut" title="Cutting" defaultOpen={false}>
                <SelectField
                    label="The dark squares"
                    hint={MODES.find(o => o.id === p.mode)!.hint}
                    value={p.mode}
                    choices={MODES}
                    onChange={(v: QrMode) => params.set({ mode: v }, { label: "Dark squares" })}
                />
                {p.mode === "inlay" && (
                    <SliderField
                        label="Trim"
                        hint="Taken off every side of every tile, so a tile drops into its pocket instead of jamming. About half a kerf is the usual answer."
                        value={p.trim}
                        min={0}
                        max={0.3}
                        step={0.01}
                        onChange={n => params.set({ trim: n }, { label: "Trim", coalesce: "trim" })}
                    />
                )}
                <ToggleField
                    label="Cut the plate"
                    hint="Cuts the square the code sits on. Off leaves the code alone, to engrave onto something that already exists."
                    checked={p.outline}
                    onChange={b => params.set({ outline: b }, { label: "Plate" })}
                />
                {p.outline && (
                    <SliderField
                        label="Corner radius"
                        value={p.radius}
                        min={0}
                        max={Math.max(1, p.size / 2)}
                        step={0.5}
                        onChange={n => params.set({ radius: n }, { label: "Corner radius", coalesce: "radius" })}
                    />
                )}
                <Field label="">
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        A QR code cannot be cut out of one piece: the middle of every finder pattern, and most of the
                        light area, is enclosed and would fall on the floor. Inlay is the only cutting that works, and
                        it is a lot of tiny pieces that are not interchangeable.
                    </p>
                </Field>
            </PanelSection>
        </Workspace>
    );
}
