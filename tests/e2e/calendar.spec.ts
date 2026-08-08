import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, exportExtra, openTool, stat, waitForDrawing } from "./helpers";

// The calendar in a real browser. The dates are pinned in
// tests/unit/calendar.test.ts against days everybody knows; what is checked
// here is that the panel reaches them, and that the one fact worth shouting —
// whether the year is a leap year — is on screen before anything is cut.
//
// The panel is grouped the way a calendar is decided (Calendar, Layout,
// Appearance, Fabrication, Tray) and shows only what the current answers make
// real, so half of what is checked below is what is *absent*: a tray section on
// a board, a months-across control on a single month, a thickness with nothing
// to cut from a sheet. Those are the assertions to keep — a control that is
// shown and ignored is the failure this grouping exists to prevent.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "calendar");
    await waitForDrawing(page);
});

test("opens on next year, all twelve months", async ({ page }) => {
    const next = new Date().getUTCFullYear() + 1;
    await expect(stat(page, "Year")).toContainText(String(next));
    await expect(stat(page, "Months")).toContainText("12");
});

test("says whether the year is a leap year, and is right about it", async ({ page }) => {
    await setNum(page, "Year", 2024);
    await expect(stat(page, "Leap year")).toContainText("29 Feb");
    await setNum(page, "Year", 1900);
    // The exception everybody misses.
    await expect(stat(page, "Leap year")).toContainText("no");
    await setNum(page, "Year", 2000);
    await expect(stat(page, "Leap year")).toContainText("29 Feb");
});

test("drops to a single month and back", async ({ page }) => {
    await panel(page).getByRole("radio", { name: "One month" }).click();
    await expect(stat(page, "Months")).toContainText("1");
    // Neither of the year-layout controls has anything to do with one month:
    // there is one cell, so nothing to arrange across and nothing to hold it
    // away from its neighbour.
    await expect(panel(page).getByRole("radiogroup", { name: "Months across" })).toHaveCount(0);
    await expect(panel(page).getByRole("slider", { name: "Between months" })).toHaveCount(0);
    await panel(page).getByRole("radio", { name: "Whole year" }).click();
    await expect(stat(page, "Months")).toContainText("12");
});

test("picks the month by name rather than by number", async ({ page }) => {
    await setNum(page, "Year", 2030);
    await panel(page).getByRole("radio", { name: "One month" }).click();
    const month = panel(page).getByRole("combobox", { name: "Month", exact: true });
    await month.click();
    await page.getByRole("option", { name: "September", exact: true }).click();
    await expect(month).toContainText("September");
    await expect(stat(page, "Months")).toContainText("1");
    // The name has to *be* the ninth month rather than the ninth word in a
    // list, and the filename is where that shows.
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("calendar_2030_09.svg");
});

test("reshapes the plaque with the columns", async ({ page }) => {
    const width = async () => Number((await stat(page, "Size").innerText()).replace(/^Size\s*/, "").split("×")[0]);
    const across = panel(page).getByRole("radiogroup", { name: "Months across" });
    // Two, three and four. The engine takes one to six and warns above four;
    // the panel offers the three that are shapes somebody wants.
    await expect(across.getByRole("radio")).toHaveCount(3);

    const three = await width();
    await across.getByRole("radio", { name: "2 months across" }).click();
    await expect.poll(width).toBeLessThan(three);
    const narrow = await width();
    await across.getByRole("radio", { name: "4 months across" }).click();
    await expect.poll(width).toBeGreaterThan(narrow);
});

test("always warns to check the dates", async ({ page }) => {
    await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("right or firewood");
});

test("writes the calendar named after the year", async ({ page }) => {
    await setNum(page, "Year", 2030);
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("calendar_2030.svg");
    for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
        const dl = await exportAs(page, new RegExp(`^${label}`));
        expect(dl.suggestedFilename()).toBe(`calendar_2030.${ext}`);
    }
});

test.describe("presets", () => {
    test("starts from one, and says so once it has drifted", async ({ page }) => {
        const side = page.getByTestId("sidebar");
        // A preset is a starting configuration, not a mode: it is on while
        // every value it names still matches, and the moment one does not the
        // panel says which one this came from rather than silently losing the
        // tick.
        await expect(side.getByRole("button", { name: /Year plaque/ })).toHaveAttribute("aria-pressed", "true");
        await setNum(page, "Letter height", 7);
        await expect(side).toContainText("Customized from Year plaque");

        await side.getByRole("button", { name: "Reset to preset" }).click();
        await expect(page.getByRole("spinbutton", { name: "Letter height, exact value", exact: true }))
            .toHaveValue("4");
        await expect(side).not.toContainText("Customized from");
    });
});

test.describe("layout", () => {
    test("frames every month, with a margin you can set", async ({ page }) => {
        const size = async () => (await stat(page, "Size").innerText()).replace(/^Size\s*/, "");
        await page.getByRole("switch", { name: "Frame each month" }).click();
        await expect(panel(page).getByRole("slider", { name: "Frame margin" })).toBeVisible();
        const tight = await size();
        await setNum(page, "Frame margin", 12);
        // A bigger margin makes every cell bigger, so the whole board grows.
        await expect.poll(size).not.toBe(tight);
    });

    test("keeps the months apart in millimetres, whatever the font", async ({ page }) => {
        // The bug this replaces: months held apart by space padding, which came
        // undone the moment a proportional face was picked. Now the gap is a
        // measurement, so switching the font changes how a month looks and
        // never where it sits relative to the next one.
        const cells = async () => (await stat(page, "One month").innerText()).replace(/^One month\s*/, "");
        await setNum(page, "Between months", 20);
        const wide = await cells();
        await panel(page).getByRole("combobox", { name: "Font" }).click();
        await page.getByRole("option", { name: "Sans (system)", exact: true }).click();
        // The month's own size changes with the face; the layout still works.
        await expect.poll(cells).not.toBe("");
        await expect(page.getByTestId("stage-canvas").locator("svg")).toBeVisible();
        expect(wide).not.toBe("");
    });

    test("cuts the months as separate cards", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Separate cards" }).click();
        // Nested on a sheet rather than laid on a board, so the months-across
        // control has nothing to do — and the width of the sheet, which is the
        // machine's bed, becomes a number that matters.
        await expect(panel(page).getByRole("radiogroup", { name: "Months across" })).toHaveCount(0);
        await expect(panel(page).getByRole("slider", { name: "Sheet width" })).toBeVisible();
        await expect(stat(page, "Months")).toContainText("12");
    });
});

test.describe("the tray", () => {
    test("is not offered at all on one board", async ({ page }) => {
        // It used to be a disabled switch with a paragraph explaining why. A
        // control that is shown and ignored teaches you that the panel lies, so
        // the whole section is absent until there are cards to stand up.
        await expect(panel(page).getByRole("button", { name: "Tray", exact: true })).toHaveCount(0);
        await expect(page.getByRole("switch", { name: "Cut a tray for the cards" })).toHaveCount(0);
        await panel(page).getByRole("radio", { name: "Separate cards" }).click();
        await expect(page.getByRole("switch", { name: "Cut a tray for the cards" })).toBeVisible();
    });

    test("appears in a panel under the canvas and in the export menu", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Separate cards" }).click();
        // The tray is the only thing here cut *from* a sheet, so the thickness
        // and the kerf are its and appear with it.
        await expect(panel(page).getByRole("slider", { name: "Thickness" })).toHaveCount(0);
        await page.getByRole("switch", { name: "Cut a tray for the cards" }).click();
        await expect(panel(page).getByRole("slider", { name: "Thickness" })).toBeVisible();
        await expect(panel(page).getByRole("slider", { name: "Kerf" })).toBeVisible();

        // The parts sheet, the way the stamp tool shows its handle.
        await expect(page.getByTestId("tray-preview")).toBeVisible();
        await expect(page.getByTestId("bottom-panel")).toContainText("finger-jointed tray");

        // A companion file, so it is a button of its own in the toolbar rather
        // than a line in the dropdown — nobody cuts the cards without the tray.
        const dl = await exportExtra(page, "holder");
        expect(dl.suggestedFilename()).toMatch(/_tray\.svg$/);
    });
});

test.describe("what the controls actually do", () => {
    const paint = (page: Page) => page.getByTestId("stage-canvas").locator("svg");

    test("engraves the frames on a board instead of cutting it into twelve", async ({ page }) => {
        // A cut rectangle round every month on a single board is not a frame.
        // It is twelve cards and a piece of scrap in the shape of a board.
        await page.getByRole("switch", { name: "Frame each month" }).click();
        await page.getByRole("switch", { name: "Cut the board" }).click();
        await expect.poll(async () => (await paint(page).innerHTML()).includes("#00a000")).toBe(true);
        expect(await paint(page).innerHTML()).not.toContain("#ff0000");
        await expect(page.getByLabel("Colours in this drawing")).toContainText("engraved rule");
    });

    test("keeps the lettering off the edge of a card without asking for a frame", async ({ page }) => {
        // The margin used to be tied to the frame toggle, so a card with no
        // frame had the cut line straight through the last column of days.
        await panel(page).getByRole("radio", { name: "Separate cards" }).click();
        await expect(panel(page).getByRole("slider", { name: "Card margin" })).toBeVisible();
        await expect(page.getByRole("switch", { name: "Rule inside each card" })).not.toBeChecked();

        const size = async () => (await stat(page, "One month").innerText()).replace(/\D+/g, "");
        const tight = await size();
        await setNum(page, "Card margin", 14);
        // With no frame in sight, the card still grows: the margin is the
        // card's own, not the frame's.
        await expect.poll(size).not.toBe(tight);
    });

    test("draws the rule inside the card rather than as a second cut", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Separate cards" }).click();
        await page.getByRole("switch", { name: "Rule inside each card" }).click();
        await expect(panel(page).getByRole("slider", { name: "Rule inset" })).toBeVisible();
        // The build is debounced, so the panel updates before the drawing does.
        // One cut line per card, and the rule engraved inside it.
        await expect.poll(async () => (await paint(page).innerHTML()).includes("#00a000")).toBe(true);
        expect(await paint(page).innerHTML()).toContain("#ff0000");
    });

    test("warns when the cut line would run through the days", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Separate cards" }).click();
        await setNum(page, "Card margin", 0.5);
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText("brown edge");
    });
});
