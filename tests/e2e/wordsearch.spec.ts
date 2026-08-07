import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

// The word search in a real browser. Placement is pinned in
// tests/unit/wordsearch.test.ts, where the grid can be searched. What only a
// browser shows is the half that turns letters into geometry — this tool sets
// two hundred glyphs through the text pipeline, and jsdom has no canvas to set
// them on.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

const setWords = async (page: Page, s: string): Promise<void> => {
    const box = page.getByLabel("Words", { exact: true });
    await box.fill(s);
    await box.blur();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "wordsearch");
    await waitForDrawing(page);
});

test("hides the words it opens with", async ({ page }) => {
    await expect(stat(page, "Grid")).toContainText("14 × 14");
    await expect(stat(page, "Hidden")).toContainText("8");
    await expect(stat(page, "Dropped")).toContainText("0");
});

test("takes words a line at a time or separated by commas", async ({ page }) => {
    await setWords(page, "one, two, three");
    await expect(stat(page, "Hidden")).toContainText("3");
});

test("drops a word too long for the grid, and says which", async ({ page }) => {
    await setWords(page, "kerf\nantidisestablishmentarianism");
    await expect(stat(page, "Dropped")).toContainText("1");
    await expect(panel(page)).toContainText("ANTIDISESTABLISHMENTARIANISM did not fit");
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("would not fit");
});

test("is the same puzzle for a seed and a different one after a shuffle", async ({ page }) => {
    const seed = page.getByLabel("Seed, exact value");
    await expect(seed).toHaveValue("1");
    await panel(page).getByRole("button", { name: /Shuffle/ }).click();
    await expect(seed).not.toHaveValue("1");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(seed).toHaveValue("1");
});

test("grows the piece with the letters", async ({ page }) => {
    const width = async () => Number((await stat(page, "Size").innerText()).replace(/^Size\s*/, "").split("×")[0]);
    const small = await width();
    await setNum(page, "Letter height", 12);
    await expect.poll(width).toBeGreaterThan(small);
});

test("engraves the letters and cuts only the outline", async ({ page }) => {
    const legend = page.getByLabel("Colours in this drawing");
    await expect(legend.getByText("letters — engraved")).toBeVisible();
    await expect(legend.getByText("cut")).toBeVisible();
    await page.getByRole("switch", { name: "Cut the board" }).click();
    await expect(legend.getByText("cut")).toHaveCount(0);
});

test("writes the puzzle in all three formats", async ({ page }) => {
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("wordsearch_14x14_1.svg");
    for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
        const dl = await exportAs(page, new RegExp(`^${label}`));
        expect(dl.suggestedFilename()).toBe(`wordsearch_14x14_1.${ext}`);
    }
});
