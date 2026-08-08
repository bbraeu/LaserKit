import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

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
