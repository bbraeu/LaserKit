import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, exportExtra, openTool, stat, waitForDrawing } from "./helpers";

// The calendar in a real browser. The dates are pinned in
// tests/unit/calendar.test.ts against days everybody knows; what is checked
// here is that the panel reaches them, and that the one fact worth shouting —
// whether the year is a leap year — is on screen before anything is cut.

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
    // The months-across control has nothing to do when there is one month.
    await expect(panel(page).getByRole("slider", { name: "Months across" })).toHaveCount(0);
    await panel(page).getByRole("radio", { name: "Whole year" }).click();
    await expect(stat(page, "Months")).toContainText("12");
});

test("reshapes the plaque with the columns", async ({ page }) => {
    const width = async () => Number((await stat(page, "Size").innerText()).replace(/^Size\s*/, "").split("×")[0]);
    await setNum(page, "Months across", 2);
    const narrow = await width();
    await setNum(page, "Months across", 4);
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
        // control has nothing to do.
        await expect(panel(page).getByRole("slider", { name: "Months across" })).toHaveCount(0);
        await expect(panel(page).getByRole("slider", { name: "Sheet width" })).toBeVisible();
        await expect(stat(page, "Months")).toContainText("12");
    });
});

test.describe("the tray", () => {
    test("is offered only for cards, and says why", async ({ page }) => {
        await panel(page).getByRole("button", { name: "Tray", exact: true }).click();
        await expect(page.getByRole("switch", { name: "Cut a tray for the cards" })).toBeDisabled();
        await expect(panel(page)).toContainText("A tray holds cards");
    });

    test("appears in a panel under the canvas and in the export menu", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Separate cards" }).click();
        await panel(page).getByRole("button", { name: "Tray", exact: true }).click();
        await page.getByRole("switch", { name: "Cut a tray for the cards" }).click();

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
