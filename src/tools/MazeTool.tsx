import { useCallback, useMemo, useState } from "react";
import { Dices, Grid3x3, Route, Ruler } from "lucide-react";
import { MAZE_LIMITS, buildMaze, mazeToDxf, mazeToFds, mazeToSvg } from "../lib/maze";
import type { MazeEnds, MazeOptions } from "../lib/maze";
import { r3 } from "../lib/design";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Workspace } from "../workspace/Workspace";
import { Field, SegmentedField, SliderField, ToggleField } from "../workspace/fields";
import { NumberField } from "../workspace/fields/NumberField";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Maze generator.
//
// The solution is a *view aid*, not a layer: engraving it onto the maze would
// be engraving the answer onto the puzzle. It is a toggle beside the grid, the
// same place the box generator keeps its part names, and for the same reason —
// it changes what the canvas says, never what is cut.
//
// The seed is a first-class control rather than a hidden implementation
// detail. Without it, dragging the cell size would reshuffle every wall and the
// maze on screen would never be the maze that got exported.
// ---------------------------------------------------------------------------

const L = MAZE_LIMITS;

interface MazeParams extends MazeOptions {}

const DEFAULTS: MazeParams = {
    cols: 20,
    rows: 20,
    cell: 6,
    border: 8,
    ends: "corners",
    braid: 0,
    seed: 1,
    outline: true
};

const ENDS = [
    { id: "corners" as const, label: "Corners", hint: "In at the top left, out at the bottom right — the way a maze is drawn on paper." },
    { id: "sides" as const, label: "Left to right", hint: "Both openings halfway up, one on each side." },
    { id: "topBottom" as const, label: "Top to bottom", hint: "Both openings halfway across, one top and one bottom." },
    { id: "none" as const, label: "Closed", hint: "No way in and no way out. That makes it a pattern rather than a maze — which is a fine thing to engrave on a box lid." }
];

const PRESETS: Preset<MazeParams>[] = [
    {
        id: "coaster",
        label: "Coaster",
        hint: "A 15 × 15 maze on a 90 mm square",
        patch: { cols: 15, rows: 15, cell: 5, border: 7, ends: "corners", braid: 0 }
    },
    {
        id: "child",
        label: "For a child",
        hint: "Wide corridors, few of them, straight through",
        patch: { cols: 8, rows: 8, cell: 12, border: 10, ends: "sides", braid: 0 }
    },
    {
        id: "hard",
        label: "As hard as it gets",
        hint: "40 × 40 cells, corner to corner",
        patch: { cols: 40, rows: 40, cell: 4, border: 6, ends: "corners", braid: 0 }
    },
    {
        id: "pattern",
        label: "Pattern, not a puzzle",
        hint: "Closed, and braided into loops — for engraving on a lid",
        patch: { ends: "none", braid: 0.6, cols: 24, rows: 24, cell: 5 }
    }
];

export default function MazeTool() {
    const params = useHistoryParams<MazeParams>(DEFAULTS, { storageKey: "laserkit:params:maze" });
    const p = params.value;

    // The answer is a reading aid, so it stays out of the settings and out of
    // the undo history — and out of every export.
    const [showSolution, setSolution] = useState(false);

    const build = useCallback((o: MazeParams) => buildMaze(o), []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        fitKey: [p.cols, p.rows, p.cell, p.border, p.outline].join("|"),
        fallbackError: "This maze could not be worked out."
    });

    const stem = useMemo(() => `maze_${p.cols}x${p.rows}_${p.seed}`, [p.cols, p.rows, p.seed]);

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "MAZE",
        build: fmt => fmt === "fds"
            ? mazeToFds(result)
            : textBlob(fmt === "dxf" ? mazeToDxf(result) : mazeToSvg(result), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = [
        { color: "#00a000", label: "walls — engraved" },
        ...(p.outline ? [{ color: "#ff0000", label: "cut" }] : [])
    ];

    // Drawn over the stage's own SVG rather than into it: the answer is not part
    // of the design, and anything in `result.preview` is one copy-paste away
    // from being in the export.
    const svg = useMemo(() => {
        if (!result) return "";
        if (!showSolution || result.solution.length < 2) return result.preview;
        const d = result.solution.map((q, i) => `${i ? "L" : "M"}${r3(q.x)} ${r3(q.y)}`).join(" ");
        return result.preview.replace(
            "</svg>",
            `<path d="${d}" fill="none" stroke="#22d3ee" stroke-opacity="0.85"`
            + ` stroke-width="${r3(Math.max(0.4, p.cell * 0.28))}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        );
    }, [result, showSolution, p.cell]);

    return (
        <Workspace
            toolId="maze"
            subject="Maze"
            subtitle={result ? `${p.cols} × ${p.rows} · ${result.width.toFixed(0)} × ${result.height.toFixed(0)} mm` : undefined}
            documentName={result ? `Maze ${p.cols} × ${p.rows}` : "Maze"}
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
            stage={{ svg, fitKey, pending }}
            stageToggles={[{
                id: "solution",
                label: "The way through",
                icon: <Route className="size-3.5" />,
                on: showSolution,
                onToggle: () => setSolution(b => !b)
            }]}
            legend={legend}
            stats={result ? [
                { label: "Size", value: `${result.width.toFixed(0)} × ${result.height.toFixed(0)} mm` },
                { label: "Cells", value: String(result.cells) },
                { label: "Dead ends", value: String(result.deadEnds), hint: "Cells with one way in and no way on. A perfect maze is mostly dead ends — that is what makes it a maze rather than a corridor." },
                { label: "The way through", value: `${result.solutionLength} cells`, hint: "How many cells the shortest route passes through. Turn on “the way through” beside the grid to see it — it is a reading aid and is in no export." },
                { label: "Wall lines", value: `${result.walls} of ${result.segments}`, hint: "Collinear neighbours are merged into one line each. Unmerged, the head would spend longer travelling between segments than burning them." },
                { label: "Engrave", value: `${(result.engraveLength / 1000).toFixed(2)} m` }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? mazeToSvg(result) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "maze-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── How big ────────────────────────────────────────────────── */}
            <PanelSection id="maze-size" title="Size" icon={<Grid3x3 className="size-3" />}>
                <SliderField
                    label="Across"
                    hint="Cells left to right. Difficulty is roughly the cell count — a 20 × 20 takes a couple of minutes to solve, a 40 × 40 rather longer than anyone will give it."
                    value={p.cols}
                    min={L.minCells}
                    max={60}
                    step={1}
                    unit=""
                    onChange={n => params.set({ cols: Math.round(n) }, { label: "Across", coalesce: "cols" })}
                />
                <SliderField
                    label="Down"
                    value={p.rows}
                    min={L.minCells}
                    max={60}
                    step={1}
                    unit=""
                    onChange={n => params.set({ rows: Math.round(n) }, { label: "Down", coalesce: "rows" })}
                />
                <SliderField
                    label="Corridor"
                    hint="One cell, and so the width of a corridor. Below about 3 mm the engraved walls run into each other and the whole thing reads as a grey block."
                    value={p.cell}
                    min={L.minCell}
                    max={30}
                    step={0.5}
                    onChange={n => params.set({ cell: n }, { label: "Corridor", coalesce: "cell" })}
                />
                <SliderField
                    label="Border"
                    hint="Solid material around the maze — somewhere for a finger to hold it, and where a name would go."
                    value={p.border}
                    min={0}
                    max={L.maxBorder}
                    step={0.5}
                    onChange={n => params.set({ border: n }, { label: "Border", coalesce: "border" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        <span className="text-muted-foreground">
                            {result.width.toFixed(0)} × {result.height.toFixed(0)} mm
                        </span>{" "}
                        finished.
                    </p>
                )}
            </PanelSection>

            {/* ── The puzzle ─────────────────────────────────────────────── */}
            <PanelSection id="maze-puzzle" title="Puzzle" icon={<Route className="size-3" />}>
                <SegmentedField
                    label="Way in and out"
                    hint={ENDS.find(o => o.id === p.ends)!.hint}
                    value={p.ends}
                    choices={ENDS}
                    onChange={(v: MazeEnds) => params.set({ ends: v }, { label: "Way in and out" })}
                />
                <SliderField
                    label="Loops"
                    hint="How many dead ends to open up. At 0 there is exactly one route between any two points, which is what everybody means by a maze. Above it the maze grows loops: it looks harder, and it solves easier, because you can no longer rule a corridor out by having been down it."
                    value={p.braid}
                    min={0}
                    max={1}
                    step={0.05}
                    unit=""
                    onChange={n => params.set({ braid: n }, { label: "Loops", coalesce: "braid" })}
                />
                <Field
                    label="Seed"
                    hint="What makes this maze this maze. The same seed always gives the same walls, so changing the corridor width does not reshuffle the puzzle — and a maze you liked can be got back."
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
                        Another maze
                    </button>
                </Field>
            </PanelSection>

            {/* ── What the laser does ────────────────────────────────────── */}
            <PanelSection id="maze-cut" title="Cutting" icon={<Ruler className="size-3" />} defaultOpen={false}>
                <ToggleField
                    label="Cut the outline"
                    hint="Cuts the finished piece out. Off leaves the walls alone, to engrave onto something that is already the right size."
                    checked={p.outline}
                    onChange={b => params.set({ outline: b }, { label: "Outline" })}
                />
                <p className="text-[11px] leading-relaxed text-subtle-foreground">
                    The walls are <strong className="text-foreground">engraved</strong>, and there is no option to cut
                    them. A wall drawn as a line and cut becomes a slot with nothing holding either side of it — cut a
                    maze's walls and what comes off the bed is a pile of loose rectangles.
                </p>
            </PanelSection>
        </Workspace>
    );
}
