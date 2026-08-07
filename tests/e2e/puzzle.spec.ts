import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

// The jigsaw, in a real browser. The knob's geometry — the undercut that makes
// it a jigsaw rather than a grid of squares with bumps on — is pinned in
// tests/unit/puzzle.test.ts. What is checked here is the wiring, and the one
// promise a generator has to keep: the same seed gives the same puzzle.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "puzzle");
    await waitForDrawing(page);
});

test("cuts one joint per shared edge, not one outline per piece", async ({ page }) => {
    // 6 × 5 pieces: five vertical lines of five, four horizontal of six.
    await expect(stat(page, "Pieces")).toContainText("30");
    await expect(stat(page, "Joints")).toContainText("49");
});

test("keeps the piece count and the board size in step", async ({ page }) => {
    await expect(stat(page, "One piece")).toContainText("33.3 × 30.0 mm");
    await setNum(page, "Across", 4);
    await expect(stat(page, "One piece")).toContainText("50.0 × 30.0 mm");
    await expect(stat(page, "Pieces")).toContainText("20");
});

test("always says the kerf is the fit", async ({ page }) => {
    await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("one kerf loose");
});

test("warns that no difficulty means no puzzle", async ({ page }) => {
    await setNum(page, "Difficulty", 0);
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("every piece fits every socket");
});

test("holds the puzzle still for a seed, and rolls a new one on demand", async ({ page }) => {
    const seed = page.getByLabel("Seed, exact value");
    await expect(seed).toHaveValue("1");
    await panel(page).getByRole("button", { name: /Another puzzle/ }).click();
    await expect(seed).not.toHaveValue("1");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(seed).toHaveValue("1");
});

test("rounds the board's corners without touching the pieces", async ({ page }) => {
    await panel(page).getByRole("button", { name: "Border", exact: true }).click();
    // innerText keeps the newline after the label and toHaveText normalises it
    // away, so the label is stripped rather than compared.
    const joints = async () => (await stat(page, "Joints").innerText()).replace(/^Joints\s*/, "");
    const before = await joints();
    await setNum(page, "Corner radius", 20);
    await expect.poll(joints).toBe(before);
});

test("writes the puzzle in all three formats", async ({ page }) => {
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("puzzle_6x5_1.svg");
    for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
        const dl = await exportAs(page, new RegExp(`^${label}`));
        expect(dl.suggestedFilename()).toBe(`puzzle_6x5_1.${ext}`);
    }
});
