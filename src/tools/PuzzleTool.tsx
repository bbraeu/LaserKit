import { useCallback, useMemo } from "react";
import { Dices, Grid3x3, Puzzle as PuzzleIcon, Ruler } from "lucide-react";
import { PUZZLE_LIMITS, buildPuzzle, puzzleToDxf, puzzleToFds, puzzleToSvg } from "../lib/puzzle";
import type { PuzzleOptions } from "../lib/puzzle";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { Field, PairField, SliderField, ToggleField } from "../workspace/fields";
import { NumberField } from "../workspace/fields/NumberField";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Jigsaw puzzle generator.
//
// Three numbers make the puzzle — how big, how many across, how many down —
// and everything else is about the knob. The panel is ordered that way, and the
// knob's own section leads with jitter rather than size, because jitter is what
// decides whether it is a puzzle at all.
// ---------------------------------------------------------------------------

const L = PUZZLE_LIMITS;

interface PuzzleParams extends PuzzleOptions {}

const DEFAULTS: PuzzleParams = {
    width: 200,
    height: 150,
    cols: 6,
    rows: 5,
    difficulty: 0.6,
    knob: 0.2,
    radius: 4,
    seed: 1,
    outline: true
};

const PRESETS: Preset<PuzzleParams>[] = [
    {
        id: "child",
        label: "For small hands",
        hint: "Twelve big pieces on an A5-ish board",
        patch: { width: 200, height: 150, cols: 4, rows: 3, knob: 0.22, difficulty: 0.35 }
    },
    {
        id: "photo",
        label: "Photo puzzle",
        hint: "60 pieces, for a picture glued on before cutting",
        patch: { width: 260, height: 200, cols: 10, rows: 6, knob: 0.2, difficulty: 0.7 }
    },
    {
        id: "coaster",
        label: "Coaster set",
        hint: "Four square pieces that break apart",
        patch: { width: 200, height: 200, cols: 2, rows: 2, knob: 0.18, difficulty: 0.15, radius: 10 }
    },
    {
        id: "hard",
        label: "Unreasonable",
        hint: "300 pieces, and good luck",
        patch: { width: 400, height: 300, cols: 20, rows: 15, knob: 0.2, difficulty: 1 }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

export default function PuzzleTool() {
    const params = useHistoryParams<PuzzleParams>(DEFAULTS, { storageKey: "laserkit:params:puzzle" });
    const p = params.value;

    const build = useCallback((o: PuzzleParams) => buildPuzzle(o), []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        fitKey: [p.width, p.height, p.outline, p.radius].join("|"),
        fallbackError: "This puzzle could not be worked out."
    });

    const stem = useMemo(() => `puzzle_${p.cols}x${p.rows}_${p.seed}`, [p.cols, p.rows, p.seed]);

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "PUZZLE",
        build: fmt => fmt === "fds"
            ? puzzleToFds(result)
            : textBlob(fmt === "dxf" ? puzzleToDxf(result) : puzzleToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = [{ color: "#ff0000", label: "cut" }];

    return (
        <Workspace
            toolId="puzzle"
            subject="Puzzle"
            subtitle={result ? `${result.pieces} pieces · ${result.pieceW.toFixed(1)} × ${mm(result.pieceH)}` : undefined}
            documentName={result ? `${p.cols} × ${p.rows} puzzle` : "Puzzle"}
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
                { label: "Pieces", value: String(result.pieces) },
                { label: "One piece", value: `${result.pieceW.toFixed(1)} × ${mm(result.pieceH)}`, hint: "On average. Above difficulty 0 the corners of the lattice wander, so no two pieces are quite the same size — which is most of what makes it hard." },
                { label: "Board", value: `${result.width.toFixed(0)} × ${result.height.toFixed(0)} mm` },
                { label: "Joints", value: String(result.joints.length), hint: "One line per shared edge. A piece and its neighbour share it, so cutting each piece's own outline would send the beam down every internal line twice — twice the job, and a joint burnt loose." },
                { label: "Cut", value: `${(result.cutLength / 1000).toFixed(2)} m` }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? puzzleToSvg(result) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "puzzle-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── How big, and how many ──────────────────────────────────── */}
            <PanelSection id="puzzle-size" title="Board" icon={<Ruler className="size-3" />}>
                <PairField
                    label="Size"
                    hint="The finished board. Glue the picture on before cutting, not after — a photo cut with the wood comes apart cleanly, and one glued to loose pieces never lines up again."
                    w={p.width}
                    h={p.height}
                    min={L.minSize}
                    onW={n => params.set({ width: n }, { label: "Width", coalesce: "width" })}
                    onH={n => params.set({ height: n }, { label: "Height", coalesce: "height" })}
                />
                <SliderField
                    label="Across"
                    value={p.cols}
                    min={L.minPieces}
                    max={L.maxPieces}
                    step={1}
                    unit=""
                    onChange={n => params.set({ cols: Math.round(n) }, { label: "Across", coalesce: "cols" })}
                />
                <SliderField
                    label="Down"
                    value={p.rows}
                    min={L.minPieces}
                    max={L.maxPieces}
                    step={1}
                    unit=""
                    onChange={n => params.set({ rows: Math.round(n) }, { label: "Down", coalesce: "rows" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        <span className="text-muted-foreground">{result.pieces} pieces</span> at{" "}
                        {mm(result.pieceW)} × {mm(result.pieceH)}.
                    </p>
                )}
            </PanelSection>

            {/* ── The bit that makes it a jigsaw ─────────────────────────── */}
            <PanelSection id="puzzle-knob" title="Pieces" icon={<PuzzleIcon className="size-3" />}>
                <SliderField
                    label="Difficulty"
                    hint="How different the pieces are from each other. It moves three things at once, and it takes all three: the corners of the lattice wander so the pieces are different sizes and the joints stop being straight, each knob slides along its own edge, and each knob is a different size. At 0 every piece fits every socket — a lovely object and a terrible puzzle. What it never touches is the neck: whether a knob locks is not negotiable."
                    value={p.difficulty}
                    min={0}
                    max={1}
                    step={0.05}
                    unit=""
                    onChange={n => params.set({ difficulty: n }, { label: "Difficulty", coalesce: "difficulty" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        {result.spread < 1.05
                            ? "Every piece the same size."
                            : <>The biggest piece is{" "}
                                <span className="text-muted-foreground">{result.spread.toFixed(1)}×</span>{" "}
                                the area of the smallest.</>}
                    </p>
                )}
                <SliderField
                    label="Knob size"
                    hint="As a fraction of the shorter side of a piece, so a long thin piece never gets a knob taller than it is wide. Bigger knobs hold better and leave less of the piece that is not knob."
                    value={p.knob}
                    min={0.1}
                    max={0.35}
                    step={0.01}
                    unit=""
                    onChange={n => params.set({ knob: n }, { label: "Knob size", coalesce: "knob" })}
                />
                <Field
                    label="Seed"
                    hint="What makes this puzzle this puzzle. The same seed always gives the same pieces, so changing the board size does not reshuffle them."
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
                        Another puzzle
                    </button>
                </Field>
            </PanelSection>

            {/* ── The board's own edge ───────────────────────────────────── */}
            <PanelSection id="puzzle-outline" title="Border" icon={<Grid3x3 className="size-3" />} defaultOpen={false}>
                <ToggleField
                    label="Cut the border"
                    hint="Off leaves the joints alone, for a board that is already the right size — a slate coaster, a piece of ply someone else cut."
                    checked={p.outline}
                    onChange={b => params.set({ outline: b }, { label: "Border" })}
                />
                {p.outline && (
                    <SliderField
                        label="Corner radius"
                        hint="Rounds the four outer corners. The pieces themselves are untouched: only the board's own edge changes."
                        value={p.radius}
                        min={0}
                        max={Math.min(L.maxRadius, Math.min(p.width, p.height) / 2)}
                        step={0.5}
                        onChange={n => params.set({ radius: n }, { label: "Corner radius", coalesce: "radius" })}
                    />
                )}
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    Every joint is cut <strong className="text-foreground">once</strong>. A piece and its neighbour
                    share it, so cutting each piece's whole outline would send the beam down every internal line twice
                    — twice the job, and the fit burnt loose.
                </p>
            </PanelSection>
        </Workspace>
    );
}
