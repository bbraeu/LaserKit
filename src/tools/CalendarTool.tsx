import { useCallback, useMemo } from "react";
import { CalendarDays, Ruler, Type } from "lucide-react";
import { CALENDAR_LIMITS, buildCalendar } from "../lib/calendar";
import type { CalendarLanguage, CalendarOptions, WeekStart } from "../lib/calendar";
import { frameDesign, framedToDxf, framedToFds, framedToSvg } from "../lib/wordsearch";
import { buildTextDesign } from "../lib/text";
import type { TextOptions } from "../lib/text";
import { availableFonts } from "../lib/fonts";
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
// Calendar plaques.
//
// The dates are worked out in lib/calendar.ts and the lettering goes through
// the text tool, the same way the word search does — a calendar is a table of
// numbers, and a table of numbers in a monospaced face is a string.
//
// The panel is short because almost nothing here is a matter of taste. A year
// has the days it has; the only real decisions are which year, where the week
// starts and how wide the plaque should be.
// ---------------------------------------------------------------------------

const L = CALENDAR_LIMITS;

interface CalendarParams extends CalendarOptions {
    fontFamily: string;
    capHeight: number;
    outline: boolean;
    radius: number;
    hole: number;
}

const thisYear = new Date().getUTCFullYear();

const DEFAULTS: CalendarParams = {
    // Next year: nobody engraves a calendar for the year they are in.
    year: thisYear + 1,
    month: null,
    weekStart: "monday",
    language: "de",
    columns: 3,
    headings: true,
    fontFamily: "monospace",
    capHeight: 4,
    outline: true,
    radius: 4,
    hole: 0
};

/** The year belongs to the job; the rest is how this workshop works. */
const TRANSIENT: (keyof CalendarParams)[] = ["year", "month"];

const WEEK = [
    { id: "monday" as const, label: "Monday", hint: "The ISO week, and what most of the world prints." },
    { id: "sunday" as const, label: "Sunday", hint: "The North American convention." }
];

const LANGS = [
    { id: "de" as const, label: "Deutsch" },
    { id: "en" as const, label: "English" }
];

const PRESETS: Preset<CalendarParams>[] = [
    {
        id: "year",
        label: "Year plaque",
        hint: "All twelve months, three across",
        patch: { month: null, columns: 3, headings: true, capHeight: 4, outline: true }
    },
    {
        id: "tall",
        label: "Tall year",
        hint: "Two months across — a narrow board for a door",
        patch: { month: null, columns: 2, capHeight: 4.5 }
    },
    {
        id: "month",
        label: "One month",
        hint: "A single month, big enough to read across a room",
        patch: { month: new Date().getUTCMonth(), capHeight: 10, columns: 1 }
    }
];

export default function CalendarTool() {
    const params = useHistoryParams<CalendarParams>(DEFAULTS, {
        storageKey: "laserkit:params:calendar",
        transient: TRANSIENT
    });
    const p = params.value;

    const aFont = useMemo(() => availableFonts(), []);

    const build = useCallback((o: CalendarParams) => {
        const cal = buildCalendar(o);
        const opt: TextOptions = {
            text: cal.text,
            fontFamily: o.fontFamily,
            bold: false,
            italic: false,
            capHeight: o.capHeight,
            letterSpacing: 0,
            wordSpacing: 0,
            lineHeight: 1.5,
            align: "left",
            shape: "straight",
            arcRadius: 40,
            arcSide: "top",
            smooth: 0,
            simplify: 0,
            // The board goes on afterwards as a rectangle: a plate that hugs a
            // calendar's ink would step in and out with every short month.
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
            framed = o.outline
                ? frameDesign(design, o.capHeight * 2.2, o.radius)
                : { aLayer: design.aLayer, width: design.width, height: design.height, preview: design.preview };
        return { cal, design, framed };
    }, []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        fitKey: [p.year, p.month, p.columns, p.capHeight, p.headings, p.outline, p.language, p.radius].join("|"),
        fallbackError: "This calendar could not be turned into geometry.",
        delay: 200
    });

    const stem = useMemo(
        () => `calendar_${p.year}${p.month === null ? "" : `_${String(p.month + 1).padStart(2, "0")}`}`,
        [p.year, p.month]
    );

    const exports: ExportItem[] = useMemo(() => (result ? designExports({
        stem,
        eventPrefix: "CALENDAR",
        build: fmt => fmt === "fds"
            ? framedToFds(result.framed)
            : textBlob(fmt === "dxf" ? framedToDxf(result.framed) : framedToSvg(result.framed), fmt)
    }) : []), [result, stem]);

    const legend: LegendItem[] = [
        { color: "#1e6bff", label: "engraved" },
        ...(p.outline ? [{ color: "#ff0000", label: "cut" }] : [])
    ];

    return (
        <Workspace
            toolId="calendar"
            subject="Calendar"
            subtitle={result ? `${p.year} · ${result.cal.months} month${result.cal.months > 1 ? "s" : ""}` : undefined}
            documentName={`Calendar ${p.year}`}
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
                { label: "Year", value: String(p.year) },
                { label: "Months", value: String(result.cal.months) },
                { label: "Leap year", value: result.cal.leap ? "yes — 29 Feb" : "no", hint: "Every four years, except every hundred, except every four hundred. 1900 was not and 2000 was — and a generator that gets this wrong is right for ninety-six years in a hundred." },
                { label: "Accuracy", value: `± ${result.design.accuracy.toFixed(3)} mm` }
            ] : []}
            warnings={[...(result?.cal.warnings ?? []), ...(result?.design.warnings ?? [])]}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? framedToSvg(result.framed) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "cal-presets",
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
            }]}
        >
            {/* ── Which dates ────────────────────────────────────────────── */}
            <PanelSection id="cal-when" title="Dates" icon={<CalendarDays className="size-3" />}>
                <Field label="Year" hint="Anything from 1900 to 2999. Leap years are worked out properly — every four, except every hundred, except every four hundred.">
                    <NumberField
                        label="Year, exact value"
                        value={p.year}
                        min={L.minYear}
                        max={L.maxYear}
                        unit=""
                        onChange={n => params.set({ year: Math.round(n) }, { label: "Year", coalesce: "year" })}
                    />
                </Field>
                <SegmentedField
                    label="Show"
                    hint="The whole year on one plaque, or a single month big enough to read from across a room."
                    value={p.month === null ? "year" : "month"}
                    choices={[
                        { id: "year", label: "Whole year", hint: "All twelve months." },
                        { id: "month", label: "One month", hint: "Just the one." }
                    ]}
                    onChange={(v: string) =>
                        params.set({ month: v === "year" ? null : new Date().getUTCMonth() }, { label: "Show" })}
                />
                {p.month !== null && (
                    <SliderField
                        label="Month"
                        value={p.month + 1}
                        min={1}
                        max={12}
                        step={1}
                        unit=""
                        onChange={n => params.set({ month: Math.round(n) - 1 }, { label: "Month", coalesce: "month" })}
                    />
                )}
                <SegmentedField
                    label="Week starts"
                    hint={WEEK.find(o => o.id === p.weekStart)!.hint}
                    value={p.weekStart}
                    choices={WEEK}
                    onChange={(v: WeekStart) => params.set({ weekStart: v }, { label: "Week starts" })}
                />
                <SegmentedField
                    label="Language"
                    hint="The month names and the day letters."
                    value={p.language}
                    choices={LANGS}
                    onChange={(v: CalendarLanguage) => params.set({ language: v }, { label: "Language" })}
                />
            </PanelSection>

            {/* ── The shape of the plaque ────────────────────────────────── */}
            <PanelSection id="cal-layout" title="Layout" icon={<Ruler className="size-3" />}>
                {p.month === null && (
                    <SliderField
                        label="Months across"
                        hint="Three or four is the shape a year calendar wants. Two makes a narrow board for a door; six makes something very wide and very short."
                        value={p.columns}
                        min={L.minColumns}
                        max={L.maxColumns}
                        step={1}
                        unit=""
                        onChange={n => params.set({ columns: Math.round(n) }, { label: "Months across", coalesce: "columns" })}
                    />
                )}
                <ToggleField
                    label="Names and the year"
                    hint="Month names above each table, and the year at the top. Off leaves the bare grids — for something that carries its own title."
                    checked={p.headings}
                    onChange={b => params.set({ headings: b }, { label: "Headings" })}
                />
                <ToggleField
                    label="Cut the board"
                    hint="A rectangle round everything, with a margin that follows the letter height."
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

            {/* ── How it is set ──────────────────────────────────────────── */}
            <PanelSection id="cal-type" title="Lettering" icon={<Type className="size-3" />}>
                <SelectField
                    label="Font"
                    hint="A monospaced face keeps the columns of a calendar in line. Anything else and the 1st and the 11th do not sit above each other."
                    value={p.fontFamily}
                    choices={aFont.map(o => ({ id: o.id, label: o.label }))}
                    onChange={v => params.set({ fontFamily: v }, { label: "Font" })}
                />
                <SliderField
                    label="Letter height"
                    hint="Cap height. A whole year at 4 mm is about an A4 board; below 3 mm the digits close up when engraved."
                    value={p.capHeight}
                    min={2}
                    max={20}
                    step={0.5}
                    onChange={n => params.set({ capHeight: n }, { label: "Letter height", coalesce: "capHeight" })}
                />
                {result && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        <span className="text-muted-foreground">
                            {result.framed.width.toFixed(0)} × {result.framed.height.toFixed(0)} mm
                        </span>{" "}
                        finished. Check the dates against a calendar you trust before you cut — this is the one thing
                        here that is either right or firewood.
                    </p>
                )}
            </PanelSection>
        </Workspace>
    );
}
