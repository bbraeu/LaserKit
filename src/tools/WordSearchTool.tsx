import { useCallback, useMemo } from "react";
import { Dices, Grid3x3, ListChecks, Type } from "lucide-react";
import {
    WORDSEARCH_LIMITS, buildWordSearch, frameDesign, framedToDxf, framedToFds, framedToSvg, gridText, listText
} from "../lib/wordsearch";
import type { Directions, WordSearchOptions } from "../lib/wordsearch";
import { buildTextDesign } from "../lib/text";
import type { TextOptions } from "../lib/text";
import { availableFonts } from "../lib/fonts";
import { cn } from "../lib/cn";
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
// Word search generator.
//
// The letters are not drawn here. The text tool already sets type in any
// installed font and traces it, so this one composes a string — the grid, a
// blank line, the word list — and hands it over in a monospaced face, where a
// grid of letters is just text that happens to line up.
//
// That is worth more than the code it saves. There is exactly one glyph
// pipeline in this kit, so a word search gets the same fidelity, the same
// fonts and the same "cap height, not font size" as everything else, and a fix
// to any of them reaches all of them.
// ---------------------------------------------------------------------------

const L = WORDSEARCH_LIMITS;

interface WordSearchParams extends Omit<WordSearchOptions, "words"> {
    /** as typed: one per line, or separated by commas */
    words: string;
    title: string;
    fontFamily: string;
    capHeight: number;
    showList: boolean;
    listColumns: number;
    outline: boolean;
    /** rounded corners on the board, mm */
    radius: number;
}

const DEFAULTS: WordSearchParams = {
    cols: 14,
    rows: 14,
    words: "laser\nkerf\nplywood\nengrave\nacrylic\nfocus\nvector\nkeychain",
    directions: "all",
    backwards: true,
    smartFill: true,
    seed: 1,
    title: "",
    // Monospace, because a grid of letters that does not line up is not a grid.
    fontFamily: "monospace",
    capHeight: 6,
    showList: true,
    listColumns: 3,
    outline: true,
    radius: 4
};

/** The words belong to this puzzle; everything else is how this workshop works. */
const TRANSIENT: (keyof WordSearchParams)[] = ["words", "title"];

const DIRECTIONS = [
    { id: "across" as const, label: "Across", hint: "Left to right only. A reading exercise rather than a puzzle — for somebody very small." },
    { id: "acrossDown" as const, label: "+ down", hint: "Across and down. The usual for children." },
    { id: "all" as const, label: "+ diagonal", hint: "Across, down and both diagonals. What an adult expects." }
];

const PRESETS: Preset<WordSearchParams>[] = [
    {
        id: "child",
        label: "For a child",
        hint: "A 10 × 10 grid, across and down, big letters",
        patch: { cols: 10, rows: 10, directions: "acrossDown", backwards: false, capHeight: 8, smartFill: false }
    },
    {
        id: "adult",
        label: "Properly hard",
        hint: "18 × 18, every direction, backwards, clever filler",
        patch: { cols: 18, rows: 18, directions: "all", backwards: true, smartFill: true, capHeight: 5 }
    },
    {
        id: "coaster",
        label: "Small and square",
        hint: "A 12 × 12 grid with no list — the answers go elsewhere",
        patch: { cols: 12, rows: 12, showList: false, capHeight: 6 }
    }
];

/** One string: the title, the grid, then the words that are actually in it. */
const compose = (p: WordSearchParams, grid: string, list: string): string =>
    [p.title.trim(), grid, p.showList ? list : ""]
        .filter(Boolean)
        .join("\n\n");

export default function WordSearchTool() {
    const params = useHistoryParams<WordSearchParams>(DEFAULTS, {
        storageKey: "laserkit:params:wordsearch",
        transient: TRANSIENT
    });
    const p = params.value;

    const aFont = useMemo(() => availableFonts(), []);

    const build = useCallback((o: WordSearchParams) => {
        const puzzle = buildWordSearch({
            cols: o.cols,
            rows: o.rows,
            // A line each, or commas — people paste both.
            words: o.words.split(/[\n,;]+/),
            directions: o.directions,
            backwards: o.backwards,
            smartFill: o.smartFill,
            seed: o.seed
        });

        const text = compose(o, gridText(puzzle), listText(puzzle, o.listColumns));
        const opt: TextOptions = {
            text,
            fontFamily: o.fontFamily,
            bold: false,
            italic: false,
            capHeight: o.capHeight,
            letterSpacing: 0,
            wordSpacing: 0,
            lineHeight: 1.6,
            align: "left",
            shape: "straight",
            arcRadius: 40,
            arcSide: "top",
            smooth: 0,
            simplify: 0,
            // No plate from the text tool: every plate it makes hugs the ink,
            // which is right for a keychain and wrong for a board — a title
            // narrower than the grid would leave a notch in the corner. The
            // rectangle goes on afterwards.
            plate: false,
            border: 0,
            connect: false,
            connectMode: "hull",
            reach: 0,
            letters: "engrave",
            letterEdges: false,
            ring: false,
            ringDiameter: 4,
            ringEdge: "left",
            ringOffset: 50,
            ringInset: 5,
            ringWall: 0
        };
        const design = buildTextDesign(opt),
            // A board wants a margin to hold it by, and it scales with the
            // lettering rather than being a number nobody can interpret.
            framed = frameDesign(design, o.outline ? o.capHeight * 1.6 : 0, o.radius);
        return { puzzle, design, framed: o.outline ? framed : { ...framed, aLayer: design.aLayer, width: design.width, height: design.height, preview: design.preview } };
    }, []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        fitKey: [p.cols, p.rows, p.capHeight, p.showList, p.outline, p.title, p.listColumns, p.radius].join("|"),
        fallbackError: "This puzzle could not be turned into geometry.",
        // Setting two hundred glyphs is the most expensive build in the kit.
        delay: 200
    });

    const stem = useMemo(() => `wordsearch_${p.cols}x${p.rows}_${p.seed}`, [p.cols, p.rows, p.seed]);

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "WORDSEARCH",
        build: fmt => fmt === "fds"
            ? framedToFds(result.framed)
            : textBlob(fmt === "dxf" ? framedToDxf(result.framed) : framedToSvg(result.framed), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = [
        { color: "#1e6bff", label: "letters — engraved" },
        ...(p.outline ? [{ color: "#ff0000", label: "cut" }] : [])
    ];

    return (
        <Workspace
            toolId="wordsearch"
            subject="Word search"
            subtitle={result ? `${p.cols} × ${p.rows} · ${result.puzzle.placed.length} words` : undefined}
            documentName={result ? `${p.cols} × ${p.rows} word search` : "Word search"}
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
            stage={{ svg: result?.framed.preview ?? "", fitKey, pending }}
            legend={legend}
            stats={result ? [
                { label: "Size", value: `${result.framed.width.toFixed(0)} × ${result.framed.height.toFixed(0)} mm` },
                { label: "Grid", value: `${p.cols} × ${p.rows}` },
                { label: "Hidden", value: String(result.puzzle.placed.length), hint: "Words actually in the grid. Any that would not fit are left off the printed list as well — a puzzle that asks for a word it does not contain is the one unforgivable bug in a word search." },
                { label: "Dropped", value: String(result.puzzle.dropped.length) },
                { label: "Accuracy", value: `± ${result.design.accuracy.toFixed(3)} mm`, hint: "How far a traced letter edge may sit from the glyph it came from." }
            ] : []}
            warnings={[...(result?.puzzle.warnings ?? []), ...(result?.design.warnings ?? [])]}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? framedToSvg(result.framed) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "ws-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── What to hide ───────────────────────────────────────────── */}
            <PanelSection id="ws-words" title="Words" icon={<ListChecks className="size-3" />}>
                <textarea
                    aria-label="Words"
                    rows={6}
                    spellCheck={false}
                    value={p.words}
                    onChange={e => params.set({ words: e.target.value }, { label: "Words", coalesce: "words" })}
                    placeholder="One per line, or separated by commas"
                    className={cn(
                        "w-full resize-y rounded-md border border-line-strong bg-panel-2 px-2 py-1.5",
                        "text-xs text-foreground outline-none transition-colors",
                        "placeholder:text-subtle-foreground hover:border-accent/40 focus:border-accent/60"
                    )}
                />
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Anything that is not a letter is dropped, and everything goes in capitals — which in German makes
                    a word with an <em>ß</em> in it one letter longer.
                    {result && result.puzzle.dropped.length > 0 && (
                        <>
                            {" "}
                            <span className="text-amber-400">
                                {result.puzzle.dropped.join(", ")} did not fit.
                            </span>
                        </>
                    )}
                </p>
            </PanelSection>

            {/* ── The grid ───────────────────────────────────────────────── */}
            <PanelSection id="ws-grid" title="Grid" icon={<Grid3x3 className="size-3" />}>
                <SliderField
                    label="Across"
                    value={p.cols}
                    min={L.minGrid}
                    max={L.maxGrid}
                    step={1}
                    unit=""
                    onChange={n => params.set({ cols: Math.round(n) }, { label: "Across", coalesce: "cols" })}
                />
                <SliderField
                    label="Down"
                    value={p.rows}
                    min={L.minGrid}
                    max={L.maxGrid}
                    step={1}
                    unit=""
                    onChange={n => params.set({ rows: Math.round(n) }, { label: "Down", coalesce: "rows" })}
                />
                <SegmentedField
                    label="Words run"
                    hint={DIRECTIONS.find(o => o.id === p.directions)!.hint}
                    value={p.directions}
                    choices={DIRECTIONS}
                    onChange={(v: Directions) => params.set({ directions: v }, { label: "Words run" })}
                />
                <ToggleField
                    label="Backwards too"
                    hint="Words may read right to left, bottom to top, or up a diagonal. Doubles the directions and roughly doubles the difficulty."
                    checked={p.backwards}
                    onChange={b => params.set({ backwards: b }, { label: "Backwards" })}
                />
                <ToggleField
                    label="Clever filler"
                    hint="Fill the gaps with letters taken from the words themselves. A grid padded from the whole alphabet gives itself away — the eye finds a Q and knows there is nothing there — so this is the single biggest thing that makes a grid hard."
                    checked={p.smartFill}
                    onChange={b => params.set({ smartFill: b }, { label: "Clever filler" })}
                />
                <Field
                    label="Seed"
                    hint="Which arrangement of the same words you get. The same seed always gives the same puzzle."
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
                        Shuffle
                    </button>
                </Field>
            </PanelSection>

            {/* ── How it is set ──────────────────────────────────────────── */}
            <PanelSection id="ws-type" title="Lettering" icon={<Type className="size-3" />}>
                <SelectField
                    label="Font"
                    hint="A monospaced face keeps the columns lined up. Anything else and the grid is not a grid — the letters are set by the browser's own shaper, so a proportional face packs an I tighter than a W."
                    value={p.fontFamily}
                    choices={aFont.map(o => ({ id: o.id, label: o.label }))}
                    onChange={v => params.set({ fontFamily: v }, { label: "Font" })}
                />
                <SliderField
                    label="Letter height"
                    hint="Cap height — set 6 and a capital comes out 6 mm, in every typeface. Below about 4 mm an engraved letter starts to close up."
                    value={p.capHeight}
                    min={3}
                    max={20}
                    step={0.5}
                    onChange={n => params.set({ capHeight: n }, { label: "Letter height", coalesce: "capHeight" })}
                />
                <Field label="Title" hint="Engraved above the grid. Leave it empty for none.">
                    <input
                        aria-label="Title"
                        spellCheck={false}
                        value={p.title}
                        onChange={e => params.set({ title: e.target.value }, { label: "Title", coalesce: "title" })}
                        placeholder="LASER WORDS"
                        className={cn(
                            "w-full rounded-md border border-line-strong bg-panel-2 px-2 py-1.5",
                            "text-xs text-foreground outline-none transition-colors",
                            "placeholder:text-subtle-foreground hover:border-accent/40 focus:border-accent/60"
                        )}
                    />
                </Field>
                <ToggleField
                    label="Print the word list"
                    hint="The words to look for, under the grid, in alphabetical order. Only the ones that actually went in."
                    checked={p.showList}
                    onChange={b => params.set({ showList: b }, { label: "Word list" })}
                />
                {p.showList && (
                    <SliderField
                        label="List columns"
                        value={p.listColumns}
                        min={1}
                        max={6}
                        step={1}
                        unit=""
                        onChange={n => params.set({ listColumns: Math.round(n) }, { label: "List columns", coalesce: "listColumns" })}
                    />
                )}
                <ToggleField
                    label="Cut the board"
                    hint="Cuts a rectangle round everything, with a margin that follows the letter height. Off leaves only the lettering, to engrave onto something you already have."
                    checked={p.outline}
                    onChange={b => params.set({ outline: b }, { label: "Board" })}
                />
                {p.outline && (
                    <SliderField
                        label="Corner radius"
                        value={p.radius}
                        min={0}
                        max={30}
                        step={0.5}
                        onChange={n => params.set({ radius: n }, { label: "Corner radius", coalesce: "radius" })}
                    />
                )}
            </PanelSection>
        </Workspace>
    );
}
