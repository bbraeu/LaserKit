import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

// The maze, in a real browser.
//
// Everything about whether the maze is *solvable* is pinned in
// tests/unit/maze.test.ts, where the walls can be read back into a graph. What
// is checked here is the half that is a promise to the person using it: that
// the seed holds still, and that the answer never reaches a file.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "maze");
    await waitForDrawing(page);
});

test.describe("a maze before anything is asked of it", () => {
    test("draws one, with no file and no drop zone", async ({ page }) => {
        await expect(page.getByTestId("empty-drop")).toHaveCount(0);
        await expect(stat(page, "Cells")).toContainText("400");
        await expect(stat(page, "Size")).toContainText("136 × 136 mm");
    });

    test("engraves the walls and cuts only the outline", async ({ page }) => {
        const legend = page.getByLabel("Colours in this drawing");
        await expect(legend.getByText("walls — engraved")).toBeVisible();
        await expect(legend.getByText("cut")).toBeVisible();
        // There is no control to cut the walls, because there cannot be one —
        // and the section that would have held it says why instead.
        await expect(panel(page).getByRole("radio", { name: "Cut", exact: true })).toHaveCount(0);
        await panel(page).getByRole("button", { name: "Cutting", exact: true }).click();
        await expect(panel(page)).toContainText("pile of loose rectangles");
    });
});

test.describe("the seed", () => {
    test("holds the maze still while everything else changes", async ({ page }) => {
        const wallCount = async () =>
            page.getByTestId("stage-canvas").locator("svg path").count();
        const before = await wallCount();
        await setNum(page, "Corridor", 12);
        // A wider corridor is the same maze drawn bigger, not a new one.
        await expect.poll(wallCount).toBe(before);
        await expect(stat(page, "Size")).toContainText("256 × 256 mm");
    });

    test("gives a different maze for a different seed", async ({ page }) => {
        const walls = async () => (await stat(page, "Wall lines").innerText()).replace(/\s+/g, " ");
        const before = await walls();
        await setNum(page, "Seed", 12345);
        await expect.poll(walls).not.toBe(before);
    });

    test("rolls a new one on demand, and it lands in the history", async ({ page }) => {
        const seed = page.getByLabel("Seed, exact value");
        await expect(seed).toHaveValue("1");
        await panel(page).getByRole("button", { name: /Another maze/ }).click();
        await expect(seed).not.toHaveValue("1");
        await page.getByRole("button", { name: "Undo" }).click();
        await expect(seed).toHaveValue("1");
    });
});

test.describe("the answer", () => {
    test("is a view aid and is in no export", async ({ page }) => {
        await page.getByRole("button", { name: "The way through" }).click();
        // It is on the canvas…
        await expect(page.getByTestId("stage-canvas").locator('svg path[stroke="#22d3ee"]')).toHaveCount(1);

        // …and not in the file.
        const src = await (await exportDefault(page)).createReadStream()
            .then(s => new Response(s as unknown as ReadableStream).text());
        expect(src).not.toContain("22d3ee");
    });

    test("disappears with the way in and out", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Closed" }).click();
        await expect(stat(page, "The way through")).toContainText("0");
    });
});

test.describe("the exports", () => {
    test("write the maze in all three formats", async ({ page }) => {
        const svg = await exportDefault(page);
        expect(svg.suggestedFilename()).toBe("maze_20x20_1.svg");
        for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
            const dl = await exportAs(page, new RegExp(`^${label}`));
            expect(dl.suggestedFilename()).toBe(`maze_20x20_1.${ext}`);
        }
    });
});
