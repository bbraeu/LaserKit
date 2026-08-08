import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Layers3, Ruler, Type, Archive } from "lucide-react";
import { CALENDAR_LIMITS, buildCalendar, cellOf, holderOptions, layoutSheets, monthLines, monthText } from "../lib/calendar";
import type { CalendarLanguage, CalendarOptions, WeekStart } from "../lib/calendar";
import { boxToSvg, buildBox } from "../lib/box";
import { framedToDxf, framedToFds, framedToSvg } from "../lib/wordsearch";
import { buildTextDesign } from "../lib/text";
import type { TextLayer, TextOptions, TextResult } from "../lib/text";
import { pathData, r3, rectRing, shelfPack, shiftRing } from "../lib/design";
import { OPERATION_COLORS } from "../lib/dxf";
import { availableFonts } from "../lib/fonts";
import { Button } from "../components/ui/button";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Preview } from "../workspace/Preview";
import { Workspace } from "../workspace/Workspace";
import { Field, ReadoutGrid, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
import { NumberField } from "../workspace/fields/NumberField";
import { designExports, textBlob } from "../workspace/formats";
import { useDebouncedBuild } from "../workspace/hooks/useDebouncedBuild";
import { useHistoryParams } from "../workspace/hooks/useHistoryParams";
import type { ExportItem, LegendItem } from "../workspace/types";

// ---------------------------------------------------------------------------
// Calendars.
//
// Each month is set on its own and **placed in millimetres**. The first version
// composed the whole year as one string and kept the months apart with spaces,
// which holds only while the font is monospaced — and there is a font picker,
// so it was one click from months walking into each other. Space padding is not
// a layout.
//
// Placing them properly also buys the two things this tool was missing: a frame
// round every month with a margin you can set, and the option to cut the months
// as separate cards. And once they are cards, they need somewhere to live — so
// the tray is the box generator, called with the numbers the cards imply.
//
// The panel is ordered the way a calendar is decided rather than the way it is
// drawn, and each section only holds what the current answer makes real:
//
//   (sidebar)   what are you making — a starting point, not a mode
//   Calendar    which dates: the year, or one month of it, and in whose week
//   Layout      one board or twelve cards, and how they are arranged
//   Appearance  the type, and what is drawn round it
//   Fabrication the machine's numbers: the bed, the sheet, the beam
//   Tray        somewhere to keep the cards — cards only, so it is cards only
//
// Nothing here is disabled. A control that is shown and ignored is worse than
// one that is absent: it teaches you that the panel lies. So a board has no
// tray section at all, a single month has no year-layout controls, and the
// thickness and the kerf appear when something is actually cut from a sheet.
// ---------------------------------------------------------------------------

const L = CALENDAR_LIMITS;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;
const MARK = OPERATION_COLORS.VECTOR_ENGRAVING!;

/** One board with every month on it, or a card per month. */
type Layout = "plaque" | "cards";

interface CalendarParams extends CalendarOptions {
    layout: Layout;
    fontFamily: string;
    capHeight: number;
    /** space between one month and the next, mm */
    sheetGap: number;
    /** a frame round every month */
    sheetFrames: boolean;
    /** clear space between the lettering and the card edge or the frame, mm */
    frameMargin: number;
    /** how far an engraved rule sits inside a card's cut edge, mm */
    frameInset: number;
    frameRadius: number;
    /** the outer board, on a plaque */
    outline: boolean;
    radius: number;
    /** a tray to stand the cards in */
    holder: boolean;
    thickness: number;
    kerf: number;
    /** the sheet the cards are nested on */
    sheetWidth: number;
}

const thisYear = new Date().getUTCFullYear();

const DEFAULTS: CalendarParams = {
    year: thisYear + 1,
    month: null,
    weekStart: "monday",
    language: "de",
    columns: 3,
    headings: true,
    layout: "plaque",
    fontFamily: "monospace",
    capHeight: 4,
    sheetGap: 6,
    sheetFrames: false,
    frameMargin: 3,
    frameInset: 2.5,
    frameRadius: 2,
    outline: true,
    radius: 4,
    holder: false,
    thickness: 3,
    kerf: 0.15,
    sheetWidth: 400
};

const TRANSIENT: (keyof CalendarParams)[] = ["year", "month"];

const WEEK = [
    { id: "monday" as const, label: "Monday", hint: "The ISO week, and what most of the world prints." },
    { id: "sunday" as const, label: "Sunday", hint: "The North American convention." }
];

const LANGS = [
    { id: "de" as const, label: "Deutsch" },
    { id: "en" as const, label: "English" }
];

const LAYOUTS = [
    { id: "plaque" as const, label: "One board", hint: "Every month on a single piece — a year to hang on a wall." },
    { id: "cards" as const, label: "Separate cards", hint: "Each month cut out on its own, nested on a sheet." }
];

/**
 * The months-across values a year board is ever worth cutting at.
 *
 * The engine takes one to six (`CALENDAR_LIMITS`) and warns above four. One is
 * a twelve-month strip and five or six is a very wide, very short plaque, so
 * the panel offers the three that are shapes somebody wants — while a value
 * arriving from anywhere else joins the list rather than leaving the control
 * showing nothing selected.
 */
const COLUMNS = [2, 3, 4];

const PRESETS: Preset<CalendarParams>[] = [
    {
        id: "year",
        label: "Year plaque",
        hint: "All twelve months on one board, three across",
        patch: { layout: "plaque", month: null, columns: 3, headings: true, capHeight: 4, outline: true, sheetFrames: false }
    },
    {
        id: "desk",
        label: "Desk cards + tray",
        hint: "Twelve framed cards and a tray to stand them in",
        patch: { layout: "cards", month: null, capHeight: 5, sheetFrames: true, frameMargin: 4, holder: true }
    },
    {
        id: "month",
        label: "One month",
        hint: "A single month, big enough to read across a room",
        patch: { layout: "plaque", month: new Date().getUTCMonth(), capHeight: 10, columns: 1 }
    }
];

const mm = (n: number): string => `${n.toFixed(1)} mm`;

/**
 * Whether every value a preset names still holds.
 *
 * The same predicate `PresetList` uses to draw its tick, restated here because
 * that one is private to it — and this tool needs the answer for a different
 * question: not "which one is on?" but "how far has this drifted from the one
 * it started as?".
 */
const matchesPatch = (o: CalendarParams, patch: Partial<CalendarParams>): boolean =>
    (Object.keys(patch) as (keyof CalendarParams)[]).every(k => Object.is(o[k], patch[k]));

/** Layers shifted somewhere, which is all placing a month amounts to. */
const moveLayers = (aLayer: TextLayer[], dx: number, dy: number): TextLayer[] =>
    aLayer.map(l => ({ ...l, rings: l.rings.map(a => shiftRing(a, dx, dy)) }));

const svgOf = (aLayer: TextLayer[], width: number, height: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(width)}mm" height="${r3(height)}mm"`
    + ` viewBox="0 0 ${r3(width)} ${r3(height)}">`
    + aLayer.map(l => {
        const d = l.rings.map(a => pathData(a, !l.open)).join(" ");
        return l.filled
            ? `<path d="${d}" fill="${l.operation.css}" fill-rule="evenodd"/>`
            : `<path d="${d}" fill="none" stroke="${l.operation.css}" stroke-width="0.3"/>`;
    }).join("")
    + "</svg>";

export default function CalendarTool() {
    const params = useHistoryParams<CalendarParams>(DEFAULTS, {
        storageKey: "laserkit:params:calendar.2",
        transient: TRANSIENT
    });
    const p = params.value;

    const aFont = useMemo(() => availableFonts(), []);

    const build = useCallback((o: CalendarParams) => {
        const cal = buildCalendar(o);

        // One design per month. Expensive — twelve renders and twelve traces —
        // and the only way the placement can be in millimetres rather than in
        // space characters.
        const typeOf = (text: string): TextResult => buildTextDesign({
            text,
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
        } satisfies TextOptions);

        const cards = o.layout === "cards",
            aDesign = cal.aMonth.map(m => typeOf(monthText({ ...o, year: cal.year }, m))),
            // A card always has a margin, whether or not it also has a frame
            // drawn on it: the cut line is the edge of the card, and lettering
            // that runs to the edge of a card is lettering with nowhere for
            // your fingers. On a board the margin only exists to sit inside a
            // frame, so with no frame there is nothing for it to be.
            margin = cards || o.sheetFrames ? o.frameMargin : 0,
            aCard = aDesign.map(d => ({ width: d.width + 2 * margin, height: d.height + 2 * margin }));

        const columns = o.month === null ? o.columns : 1,
            aLayer: TextLayer[] = [];
        let width = 0,
            height = 0,
            cardW = 0,
            cardH = 0;

        if (cards) {
            // Every card the same size, whatever its month needs, so a stack of
            // them is a stack rather than a fan.
            cardW = Math.max(...aCard.map(c => c.width));
            cardH = Math.max(...aCard.map(c => c.height));
            const pack = shelfPack(aCard.map(() => ({ w: cardW, h: cardH })), o.sheetWidth, o.sheetGap);
            width = pack.width;
            height = pack.height;
            aDesign.forEach((d, i) => {
                const q = pack.aPlaced[i]!;
                aLayer.push(...moveLayers(d.aLayer, q.x + (cardW - d.width) / 2, q.y + (cardH - d.height) / 2));
                // The edge of the card. This is the cut.
                aLayer.push({
                    operation: CUT,
                    rings: [rectRing({ x0: q.x, y0: q.y, x1: q.x + cardW, y1: q.y + cardH }, o.frameRadius)],
                    filled: false
                });
                // And, if asked for, a rule drawn inside it. Engraved — a
                // second cut line a couple of millimetres inside the first
                // would simply cut the card into a card and a picture frame.
                if (o.sheetFrames) {
                    const k = Math.min(o.frameInset, cardW / 2 - 1, cardH / 2 - 1);
                    if (k > 0) {
                        aLayer.push({
                            operation: MARK,
                            rings: [rectRing(
                                { x0: q.x + k, y0: q.y + k, x1: q.x + cardW - k, y1: q.y + cardH - k },
                                Math.max(0, o.frameRadius - k)
                            )],
                            filled: false
                        });
                    }
                }
            });
        } else {
            const grid = layoutSheets(aCard, columns, o.sheetGap),
                head = o.headings && o.month === null ? typeOf(String(cal.year)) : null,
                headH = head ? head.height + o.sheetGap * 1.5 : 0,
                pad = o.outline ? o.capHeight * 2.2 : 0;

            width = grid.width + 2 * pad;
            height = grid.height + headH + 2 * pad;
            cardW = aCard.length ? Math.max(...aCard.map(c => c.width)) : 0;
            cardH = aCard.length ? Math.max(...aCard.map(c => c.height)) : 0;

            if (head) aLayer.push(...moveLayers(head.aLayer, pad, pad));

            aDesign.forEach((d, i) => {
                const q = grid.aPlaced[i]!;
                aLayer.push(...moveLayers(d.aLayer, pad + q.x + margin, pad + headH + q.y + margin));
                if (o.sheetFrames) {
                    const cell = cellOf(aCard, columns, o.sheetGap, i);
                    aLayer.push({
                        // Engraved, not cut. A cut rectangle round every month
                        // on a single board is not a frame — it is twelve cards
                        // and a piece of scrap in the shape of a board.
                        operation: MARK,
                        rings: [rectRing({
                            x0: pad + cell.x,
                            y0: pad + headH + cell.y,
                            x1: pad + cell.x + cell.width,
                            y1: pad + headH + cell.y + cell.height
                        }, o.frameRadius)],
                        filled: false
                    });
                }
            });

            if (o.outline) {
                aLayer.push({
                    operation: CUT,
                    rings: [rectRing({ x0: 0, y0: 0, x1: width, y1: height }, o.radius)],
                    filled: false
                });
            }
        }

        // The tray, from the box generator: a tray for calendar cards and a
        // parts sorter are the same object.
        const holder = o.holder && o.layout === "cards"
            ? buildBox(holderOptions(cardW, cardH, aDesign.length, o.thickness, o.kerf))
            : null;

        const warnings = [...cal.warnings];
        if (cards && margin < 2) {
            warnings.push(
                `A ${mm(margin)} card margin puts the cut line almost on the lettering. The beam takes about a tenth `
                + "of a millimetre and chars a little either side of that, so anything under two millimetres comes "
                + "back with a brown edge through the last column of days."
            );
        }
        if (o.holder && o.layout === "plaque") {
            warnings.push("A tray holds cards, and this is one board — switch to separate cards, or turn the tray off.");
        }

        return {
            cal,
            framed: { aLayer, width, height, preview: svgOf(aLayer, width, height) },
            holder,
            cardW,
            cardH,
            warnings
        };
    }, []);

    const { result, error, fitKey, pending } = useDebouncedBuild({
        input: p,
        build,
        fitKey: [
            p.year, p.month, p.columns, p.capHeight, p.headings, p.outline, p.language,
            p.radius, p.layout, p.sheetGap, p.sheetFrames, p.frameMargin, p.frameInset, p.sheetWidth
        ].join("|"),
        fallbackError: "This calendar could not be turned into geometry.",
        // Twelve renders and twelve traces: the most expensive build in the kit.
        delay: 260
    });

    const stem = useMemo(
        () => `calendar_${p.year}${p.month === null ? "" : `_${String(p.month + 1).padStart(2, "0")}`}`,
        [p.year, p.month]
    );

    const exports: ExportItem[] = useMemo(() => {
        if (!result) return [];
        return [
            ...designExports({
                stem,
                eventPrefix: "CALENDAR",
                build: fmt => fmt === "fds"
                    ? framedToFds(result.framed)
                    : textBlob(fmt === "dxf" ? framedToDxf(result.framed) : framedToSvg(result.framed), fmt)
            }),
            ...(result.holder ? [{
                id: "holder",
                label: "Card tray",
                desc: `${result.holder.aPart.length} panels — a finger-jointed tray ${mm(result.holder.outer.w)} × ${mm(result.holder.outer.d)} × ${mm(result.holder.outer.h)} to stand the cards in`,
                filename: `${stem}_tray.svg`,
                blob: () => textBlob(boxToSvg(result.holder!), "svg"),
                event: "CALENDAR_TRAY_Download",
                group: "extra" as const
            }] : [])
        ];
    }, [result, stem]);

    const legend: LegendItem[] = [
        { color: "#1e6bff", label: "engraved" },
        ...(p.sheetFrames ? [{ color: "#00a000", label: "engraved rule" }] : []),
        ...(p.outline || p.layout === "cards" ? [{ color: "#ff0000", label: "cut" }] : [])
    ];

    // The two answers every other control in the panel is conditioned on: what
    // is being made, and whether it is a year or one month of one.
    const bCards = p.layout === "cards",
        bYear = p.month === null;

    /**
     * The month names, in the chosen language.
     *
     * There is exactly one list of them in this kit and it is private to
     * lib/calendar, so the name is read back out of the heading line the
     * calendar itself sets rather than copied here. A second list would be a
     * second thing to translate and a second thing to fall out of step with
     * what is engraved on the board.
     */
    const aMonthName = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        label: monthLines({
            year: thisYear,
            month: i,
            weekStart: "monday",
            language: p.language,
            columns: 1,
            headings: true
        }, i)[0]!.trim()
    })), [p.language]);

    const aColumn = useMemo(() => (COLUMNS.includes(p.columns) ? COLUMNS : [...COLUMNS, p.columns].sort((a, b) => a - b))
        // The visible label is the digit; a bare "3" is no name at all to read
        // out, so the accessible one says what three of them are.
        .map(n => ({ id: String(n), label: String(n), srLabel: `${n} months across` })), [p.columns]);

    // Which preset this started as, so drifting away from it can be named. A
    // preset is a starting configuration rather than a mode: it stops matching
    // the moment a slider moves, and the only useful thing left to say then is
    // which one it was and how to get back to it.
    const idPreset = PRESETS.find(o => matchesPatch(p, o.patch))?.id ?? null;
    const [idBase, setBase] = useState<string | null>(null);
    useEffect(() => { if (idPreset) setBase(idPreset); }, [idPreset]);
    const oBase = PRESETS.find(o => o.id === idBase) ?? null,
        bCustom = !!oBase && !idPreset;

    return (
        <Workspace
            toolId="calendar"
            subject="Calendar"
            subtitle={result ? `${p.year} · ${result.cal.aMonth.length} month${result.cal.aMonth.length > 1 ? "s" : ""}` : undefined}
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
                { label: "Months", value: String(result.cal.aMonth.length) },
                { label: "One month", value: `${result.cardW.toFixed(0)} × ${result.cardH.toFixed(0)} mm`, hint: "Every month is set on its own and placed in millimetres, so nothing about the font can make two of them collide — and every cell is the size of the largest, so February does not move March." },
                { label: "Leap year", value: result.cal.leap ? "yes — 29 Feb" : "no", hint: "Every four years, except every hundred, except every four hundred. 1900 was not and 2000 was." }
            ] : []}
            warnings={result?.warnings ?? []}
            exports={exports}
            sendTo={{ name: stem, svg: () => (result ? framedToSvg(result.framed) : ""), disabled: !result }}
            sidebarBlocks={[{
                id: "cal-presets",
                // The question first, because it is the one the tool can answer
                // in a click and the panel of twenty controls cannot.
                title: "What are you making?",
                children: (
                    <div className="space-y-2">
                        <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
                        {/* Divergence is stated in words rather than by the tick
                            simply going out: a preset that quietly stops being
                            ticked reads as a bug, and there is nowhere to go
                            back to. Never by colour — this has to survive being
                            printed in grey. */}
                        {bCustom && oBase && (
                            <div className="flex items-center gap-2 border-t border-line pt-2">
                                <span className="min-w-0 flex-1 truncate text-[11px] text-subtle-foreground">
                                    Customized from {oBase.label}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => params.set(oBase.patch, { label: `Reset to ${oBase.label}` })}
                                >
                                    Reset to preset
                                </Button>
                            </div>
                        )}
                    </div>
                )
            }]}
            bottomPanels={result?.holder ? [{
                id: "tray",
                title: `Card tray (${result.holder.aPart.length} panels)`,
                defaultOpen: true,
                children: (
                    <div className="grid h-full gap-3 lg:grid-cols-[1fr_18rem]">
                        <Preview
                            svg={boxToSvg(result.holder)}
                            fitKey={`tray|${result.holder.width}|${result.holder.height}`}
                            subject="card tray"
                            className="min-h-56"
                            data-testid="tray-preview"
                        />
                        <div className="space-y-2">
                            <p className="text-[11px] leading-relaxed text-subtle-foreground">
                                A finger-jointed tray {mm(result.holder.outer.w)} × {mm(result.holder.outer.d)} ×{" "}
                                {mm(result.holder.outer.h)}, cut from the same {mm(p.thickness)} sheet — deep enough
                                for {result.cal.aMonth.length} cards and half a card tall, so the month you want is
                                readable without taking it out. It is the box generator, not a second one: the joints
                                and the kerf compensation are the ones that are already tested. Export →{" "}
                                <span className="text-muted-foreground">Card tray</span>.
                            </p>
                            <ul className="space-y-1.5">
                                {result.holder.aPart.map((o, i) => (
                                    <li key={`${o.label}-${i}`} className="text-[11px] leading-snug text-subtle-foreground">
                                        <span className="text-muted-foreground">{o.label}</span> — {o.note}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )
            }] : undefined}
        >
            {/* ── What it came out as ────────────────────────────────────── */}
            {/* Above the controls rather than under them: the four numbers that
                say whether this is the thing you meant are worth more than the
                first slider, and a panel you have to scroll to the foot of to
                find the finished size is a panel that hides its answer. */}
            {result && (
                <div className="border-b border-line px-3 py-2.5" data-testid="cal-readout">
                    <ReadoutGrid
                        items={[
                            { label: "Finished", value: `${result.framed.width.toFixed(0)} × ${result.framed.height.toFixed(0)} mm` },
                            { label: "Months", value: String(result.cal.aMonth.length) },
                            ...(bYear && !bCards ? [{ label: "Across", value: String(p.columns) }] : []),
                            { label: "Letter height", value: mm(p.capHeight) }
                        ]}
                    />
                </div>
            )}

            {/* ── Which dates ────────────────────────────────────────────── */}
            <PanelSection id="cal-when" title="Calendar" icon={<CalendarDays className="size-3" />}>
                <SegmentedField
                    label="Show"
                    hint="The whole year, or a single month big enough to read from across a room."
                    value={bYear ? "year" : "month"}
                    choices={[
                        { id: "year", label: "Whole year", hint: "All twelve months." },
                        { id: "month", label: "One month", hint: "Just the one." }
                    ]}
                    onChange={(v: string) =>
                        params.set({ month: v === "year" ? null : new Date().getUTCMonth() }, { label: "Show" })}
                />
                <Field
                    label="Year"
                    hint="1900 to 2999, with the leap years worked out properly."
                    control={
                        <NumberField
                            label="Year, exact value"
                            value={p.year}
                            min={L.minYear}
                            max={L.maxYear}
                            unit=""
                            onChange={n => params.set({ year: Math.round(n) }, { label: "Year", coalesce: "year" })}
                        />
                    }
                />
                {/* By name. A number from 1 to 12 is a thing to count on your
                    fingers, and the names are already set on the board. */}
                {!bYear && (
                    <SelectField
                        label="Month"
                        value={String(p.month)}
                        choices={aMonthName}
                        onChange={v => params.set({ month: Number(v) }, { label: "Month" })}
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

            {/* ── One board or twelve cards ──────────────────────────────── */}
            <PanelSection id="cal-layout" title="Layout" icon={<Ruler className="size-3" />}>
                <SegmentedField
                    label="Make"
                    hint={LAYOUTS.find(o => o.id === p.layout)!.hint}
                    value={p.layout}
                    choices={LAYOUTS}
                    onChange={(v: Layout) => params.set({ layout: v }, { label: "Make" })}
                />
                {bYear && !bCards && (
                    <SegmentedField
                        label="Months across"
                        hint="Three or four is the shape a year board wants; two makes a narrow one for a door."
                        value={String(p.columns)}
                        choices={aColumn}
                        onChange={v => params.set({ columns: Number(v) }, { label: "Months across" })}
                    />
                )}
                {/* One month has no neighbour to be held away from, in either
                    mode — the gap is measured between cells, and there is one
                    cell. */}
                {bYear && (
                    <SliderField
                        label={bCards ? "Between cards" : "Between months"}
                        hint={bCards
                            ? "Room for the head to get round a card without scorching the next one."
                            : "Space between one month and the next, in millimetres."}
                        value={p.sheetGap}
                        min={0}
                        max={40}
                        step={0.5}
                        onChange={n => params.set({ sheetGap: n }, { label: "Between months", coalesce: "sheetGap" })}
                    />
                )}
                {/*
                    On cards the margin is not optional and never has been: the
                    cut line is the edge of the card, so without a margin the
                    lettering runs off the edge. It used to be tied to the frame
                    toggle, which meant a card with no frame had no margin
                    either. It sits here, with the card's corners, because both
                    are the shape of the piece rather than what is drawn on it.
                */}
                {bCards && (
                    <>
                        <SliderField
                            label="Card margin"
                            hint="What your fingers hold, and what keeps the cut line off the last column of days."
                            value={p.frameMargin}
                            min={0}
                            max={25}
                            step={0.5}
                            onChange={n => params.set({ frameMargin: n }, { label: "Card margin", coalesce: "frameMargin" })}
                        />
                        <SliderField
                            label="Card corners"
                            hint="Rounded corners cut faster than square ones and survive a pocket."
                            value={p.frameRadius}
                            min={0}
                            max={15}
                            step={0.5}
                            onChange={n => params.set({ frameRadius: n }, { label: "Card corners", coalesce: "frameRadius" })}
                        />
                    </>
                )}
                {!bCards && (
                    <>
                        <ToggleField
                            label="Cut the board"
                            hint="A rectangle round everything, with a margin that follows the letter height."
                            checked={p.outline}
                            onChange={b => params.set({ outline: b }, { label: "Board" })}
                        />
                        {p.outline && (
                            <SliderField
                                label="Board corners"
                                value={p.radius}
                                min={0}
                                max={30}
                                step={0.5}
                                onChange={n => params.set({ radius: n }, { label: "Board corners", coalesce: "radius" })}
                            />
                        )}
                    </>
                )}
            </PanelSection>

            {/* ── How it is set ──────────────────────────────────────────── */}
            <PanelSection id="cal-look" title="Appearance" icon={<Type className="size-3" />}>
                <SelectField
                    label="Font"
                    hint="A monospaced face keeps the 1st above the 11th; a proportional one makes each month ragged."
                    value={p.fontFamily}
                    choices={aFont.map(o => ({ id: o.id, label: o.label }))}
                    onChange={v => params.set({ fontFamily: v }, { label: "Font" })}
                />
                <SliderField
                    label="Letter height"
                    hint="Cap height. A whole year at 4 mm is about an A4 board; below 3 mm the digits close up."
                    value={p.capHeight}
                    min={2}
                    max={20}
                    step={0.5}
                    onChange={n => params.set({ capHeight: n }, { label: "Letter height", coalesce: "capHeight" })}
                />
                {/*
                    Shown in both modes, because it works in both. It used to be
                    hidden on cards while still being obeyed there, so whatever
                    it had been left at on a board was what the cards came out
                    with and there was no way to see it, let alone change it.
                */}
                <ToggleField
                    label={bYear && !bCards ? "Names and the year" : bYear ? "Month names" : "Month name"}
                    hint={bYear && !bCards
                        ? "Month names above each table, and the year at the top."
                        : bCards
                            ? "The month's name above its table. A card of numbers with no name on it is a puzzle."
                            : "The month's name above its table."}
                    checked={p.headings}
                    onChange={b => params.set({ headings: b }, { label: "Headings" })}
                />
                <ToggleField
                    label={bCards ? "Rule inside each card" : bYear ? "Frame each month" : "Frame the month"}
                    hint={bCards
                        ? "An engraved rectangle inside the card's edge — engraved, not cut."
                        : "An engraved rectangle round every month. Engraved: cut, it would be twelve loose pieces."}
                    checked={p.sheetFrames}
                    onChange={b => params.set({ sheetFrames: b }, { label: "Frames" })}
                />
                {p.sheetFrames && bCards && (
                    <SliderField
                        label="Rule inset"
                        hint="How far the engraved rule sits inside the cut edge."
                        value={p.frameInset}
                        min={0.5}
                        max={12}
                        step={0.5}
                        onChange={n => params.set({ frameInset: n }, { label: "Rule inset", coalesce: "frameInset" })}
                    />
                )}
                {p.sheetFrames && !bCards && (
                    <>
                        <SliderField
                            label="Frame margin"
                            hint="Clear space between a month and the rule drawn round it."
                            value={p.frameMargin}
                            min={0}
                            max={25}
                            step={0.5}
                            onChange={n => params.set({ frameMargin: n }, { label: "Frame margin", coalesce: "frameMargin" })}
                        />
                        <SliderField
                            label="Frame corners"
                            value={p.frameRadius}
                            min={0}
                            max={15}
                            step={0.5}
                            onChange={n => params.set({ frameRadius: n }, { label: "Frame corners", coalesce: "frameRadius" })}
                        />
                    </>
                )}
            </PanelSection>

            {/* ── The machine's numbers ──────────────────────────────────── */}
            {/* A board is one piece cut from whatever is on the bed: nothing
                here is read for it, so none of it is shown. The thickness and
                the kerf are the tray's — they are what the finger joints are
                worked out from, and nothing else in this tool asks. */}
            {bCards && (
                <PanelSection id="cal-make" title="Fabrication" icon={<Layers3 className="size-3" />}>
                    <SliderField
                        label="Sheet width"
                        hint="The cards are nested in rows no wider than this — set it to your machine's bed."
                        value={p.sheetWidth}
                        min={100}
                        max={800}
                        step={10}
                        onChange={n => params.set({ sheetWidth: n }, { label: "Sheet width", coalesce: "sheetWidth" })}
                    />
                    {p.holder && (
                        <>
                            <SliderField
                                label="Thickness"
                                hint="Every joint in the tray is exactly this deep, so measure the board rather than trusting the label."
                                value={p.thickness}
                                min={0.8}
                                max={12}
                                step={0.1}
                                onChange={n => params.set({ thickness: n }, { label: "Thickness", coalesce: "thickness" })}
                            />
                            <SliderField
                                label="Kerf"
                                hint="How much width the beam burns away. Taken out of every finger and added to every notch."
                                value={p.kerf}
                                min={0}
                                max={1}
                                step={0.01}
                                onChange={n => params.set({ kerf: n }, { label: "Kerf", coalesce: "kerf" })}
                            />
                        </>
                    )}
                </PanelSection>
            )}

            {/* ── Somewhere to keep them ─────────────────────────────────── */}
            {/* A tray holds cards. On a board the section is not disabled with
                an explanation of why — it is not there, which is the same
                sentence without the dead switch. */}
            {bCards && (
                <PanelSection id="cal-holder" title="Tray" icon={<Archive className="size-3" />}>
                    <ToggleField
                        label="Cut a tray for the cards"
                        hint="A finger-jointed tray to stand the cards in. It appears in a panel under the canvas and in the export menu."
                        checked={p.holder}
                        onChange={b => params.set({ holder: b }, { label: "Tray" })}
                    />
                    {p.holder && (
                        <p className="text-[11px] leading-relaxed text-subtle-foreground">
                            Cut from the same sheet as the cards; its thickness and kerf are under{" "}
                            <span className="text-muted-foreground">Fabrication</span>.
                        </p>
                    )}
                </PanelSection>
            )}
        </Workspace>
    );
}
