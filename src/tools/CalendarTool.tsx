import { useCallback, useMemo } from "react";
import { CalendarDays, Ruler, Type, Archive } from "lucide-react";
import { CALENDAR_LIMITS, buildCalendar, cellOf, holderOptions, layoutSheets, monthText } from "../lib/calendar";
import type { CalendarLanguage, CalendarOptions, WeekStart } from "../lib/calendar";
import { boxToSvg, buildBox } from "../lib/box";
import { framedToDxf, framedToFds, framedToSvg } from "../lib/wordsearch";
import { buildTextDesign } from "../lib/text";
import type { TextLayer, TextOptions, TextResult } from "../lib/text";
import { pathData, r3, rectRing, shelfPack, shiftRing } from "../lib/design";
import { OPERATION_COLORS } from "../lib/dxf";
import { availableFonts } from "../lib/fonts";
import { PanelSection } from "../workspace/PanelSection";
import { PresetList } from "../workspace/PresetList";
import type { Preset } from "../workspace/PresetList";
import { Preview } from "../workspace/Preview";
import { Workspace } from "../workspace/Workspace";
import { Field, SegmentedField, SelectField, SliderField, ToggleField } from "../workspace/fields";
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
// ---------------------------------------------------------------------------

const L = CALENDAR_LIMITS;
const CUT = OPERATION_COLORS.VECTOR_CUTTING!;

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
    /** clear space inside a frame, mm */
    frameMargin: number;
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
    { id: "cards" as const, label: "Separate cards", hint: "Each month cut out on its own, nested on a sheet. A desk calendar you flip, and the thing the tray is for." }
];

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

        const aDesign = cal.aMonth.map(m => typeOf(monthText({ ...o, year: cal.year }, m))),
            margin = o.sheetFrames ? o.frameMargin : 0,
            // A card is its month plus the margin the frame leaves round it.
            aCard = aDesign.map(d => ({ width: d.width + 2 * margin, height: d.height + 2 * margin }));

        const columns = o.month === null ? o.columns : 1,
            aLayer: TextLayer[] = [];
        let width = 0,
            height = 0,
            cardW = 0,
            cardH = 0;

        if (o.layout === "cards") {
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
                aLayer.push({
                    operation: CUT,
                    rings: [rectRing({ x0: q.x, y0: q.y, x1: q.x + cardW, y1: q.y + cardH }, o.frameRadius)],
                    filled: false
                });
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
                        operation: CUT,
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
        if (o.layout === "cards" && !o.sheetFrames) {
            warnings.push("Cards are being cut with no frame, so the cut line runs close to the lettering. Turn the frames on, or raise the margin.");
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
            p.radius, p.layout, p.sheetGap, p.sheetFrames, p.frameMargin, p.sheetWidth
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
        ...(p.outline || p.sheetFrames || p.layout === "cards" ? [{ color: "#ff0000", label: "cut" }] : [])
    ];

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
                title: "Presets",
                children: <PresetList presets={PRESETS} current={p} onApply={(patch, label) => params.set(patch, { label })} />
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
                    hint="The whole year, or a single month big enough to read from across a room."
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

            {/* ── One board or twelve cards ──────────────────────────────── */}
            <PanelSection id="cal-layout" title="Layout" icon={<Ruler className="size-3" />}>
                <SegmentedField
                    label="Make"
                    hint={LAYOUTS.find(o => o.id === p.layout)!.hint}
                    value={p.layout}
                    choices={LAYOUTS}
                    onChange={(v: Layout) => params.set({ layout: v }, { label: "Make" })}
                />
                {p.month === null && p.layout === "plaque" && (
                    <SliderField
                        label="Months across"
                        hint="Three or four is the shape a year board wants. Two makes a narrow one for a door."
                        value={p.columns}
                        min={L.minColumns}
                        max={L.maxColumns}
                        step={1}
                        unit=""
                        onChange={n => params.set({ columns: Math.round(n) }, { label: "Months across", coalesce: "columns" })}
                    />
                )}
                <SliderField
                    label="Between months"
                    hint="Space between one month and the next, in millimetres — a real measurement rather than three space characters, which is what it used to be."
                    value={p.sheetGap}
                    min={0}
                    max={40}
                    step={0.5}
                    onChange={n => params.set({ sheetGap: n }, { label: "Between months", coalesce: "sheetGap" })}
                />
                <ToggleField
                    label="Frame each month"
                    hint="A rectangle round every month. On separate cards it is the cut line; on one board it is engraved ruling that makes the table read as a table."
                    checked={p.sheetFrames}
                    onChange={b => params.set({ sheetFrames: b }, { label: "Frames" })}
                />
                {(p.sheetFrames || p.layout === "cards") && (
                    <>
                        <SliderField
                            label="Frame margin"
                            hint="Clear space between the lettering and its frame. On a card this is what your fingers hold."
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
                {p.layout === "plaque" && (
                    <>
                        <ToggleField
                            label="Names and the year"
                            hint="Month names above each table, and the year at the top."
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
                {p.layout === "cards" && (
                    <SliderField
                        label="Sheet width"
                        hint="The cards are nested in rows no wider than this — set it to your machine's bed."
                        value={p.sheetWidth}
                        min={100}
                        max={800}
                        step={10}
                        onChange={n => params.set({ sheetWidth: n }, { label: "Sheet width", coalesce: "sheetWidth" })}
                    />
                )}
            </PanelSection>

            {/* ── Somewhere to keep them ─────────────────────────────────── */}
            <PanelSection id="cal-holder" title="Tray" icon={<Archive className="size-3" />} defaultOpen={false}>
                <ToggleField
                    label="Cut a tray for the cards"
                    hint="A finger-jointed tray to stand the cards in, deep enough for the whole year and half a card tall so the month you want is readable without taking it out. It appears in a panel under the canvas and in the export menu, and it is the box generator rather than a second one."
                    checked={p.holder}
                    disabled={p.layout !== "cards"}
                    onChange={b => params.set({ holder: b }, { label: "Tray" })}
                />
                {p.layout !== "cards" && (
                    <p className="text-[11px] leading-relaxed text-subtle-foreground">
                        A tray holds cards. Switch <em>Make</em> to <strong className="text-foreground">separate
                        cards</strong> first.
                    </p>
                )}
                {p.holder && p.layout === "cards" && (
                    <>
                        <SliderField
                            label="Thickness"
                            hint="The sheet the cards and the tray are cut from. Every joint in the tray is exactly this deep, so measure the actual board rather than trusting the label."
                            value={p.thickness}
                            min={0.8}
                            max={12}
                            step={0.1}
                            onChange={n => params.set({ thickness: n }, { label: "Thickness", coalesce: "thickness" })}
                        />
                        <SliderField
                            label="Kerf"
                            hint="How much width the beam burns away. Taken out of every finger and added to every notch, so the tray taps together instead of arriving loose."
                            value={p.kerf}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={n => params.set({ kerf: n }, { label: "Kerf", coalesce: "kerf" })}
                        />
                    </>
                )}
            </PanelSection>

            {/* ── How it is set ──────────────────────────────────────────── */}
            <PanelSection id="cal-type" title="Lettering" icon={<Type className="size-3" />}>
                <SelectField
                    label="Font"
                    hint="A monospaced face keeps the columns inside a month in line — the 1st and the 11th have to sit above each other. The months themselves are placed in millimetres, so a proportional face no longer makes them collide; it only makes each one ragged."
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
                        finished. Check the dates against a calendar you trust before you cut.
                    </p>
                )}
            </PanelSection>
        </Workspace>
    );
}
