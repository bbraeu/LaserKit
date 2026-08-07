import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

// The box generator, in a real browser.
//
// The geometry itself is pinned in tests/unit/box.test.ts, where the seams can
// actually be measured. What can only be checked here is that the numbers in
// the panel reach it: this is the one tool with no file to open, so if the
// wiring between the inspector and the builder breaks there is nothing on the
// stage to notice it — the last box just stays there looking correct.

const panel = (page: Page) => page.getByTestId("inspector");

/**
 * The shared setNumber() matches an accessible name loosely, and this panel has
 * both a "Width" and a "Finger width" — so the box's fields are addressed
 * exactly. Not a fault in either name: they are the two right words for two
 * different things, and only substring matching confuses them.
 */
const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

/** Sections that start collapsed, because most boxes never need them. */
const openSection = (page: Page, title: string) =>
    panel(page).getByRole("button", { name: title, exact: true }).click();

test.beforeEach(async ({ page }) => {
    await openTool(page, "box");
    await waitForDrawing(page);
});

test.describe("a tool with nothing to open", () => {
    test("draws a box before anything has been dropped on it", async ({ page }) => {
        // No empty state, no drop zone: there is always a box.
        await expect(page.getByTestId("empty-drop")).toHaveCount(0);
        await expect(stat(page, "Parts")).toContainText("5");
    });

    test("offers no Open button, because there is nothing to open", async ({ page }) => {
        await expect(page.getByTestId("toolbar").getByRole("button", { name: "Open" })).toHaveCount(0);
        await expect(page.getByTestId("stage-file-input")).toHaveCount(0);
    });

    test("still exports, and New puts the settings back", async ({ page }) => {
        await setNum(page, "Width", 250);
        await expect(stat(page, "Outside")).toContainText("250.0");
        await page.getByTestId("toolbar").getByRole("button", { name: "New" }).click();
        await expect(stat(page, "Outside")).toContainText("120.0");
    });
});

test.describe("size", () => {
    test("reports the outside and the space left inside", async ({ page }) => {
        await expect(stat(page, "Outside")).toContainText("120.0 × 90.0 × 60.0 mm");
        // Two 3 mm walls each way, one 3 mm floor.
        await expect(stat(page, "Inside")).toContainText("114.0 × 84.0 × 57.0 mm");
    });

    test("adds the walls on when the numbers mean the inside", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Inside" }).click();
        await expect(stat(page, "Inside")).toContainText("120.0 × 90.0 × 60.0 mm");
        await expect(stat(page, "Outside")).toContainText("126.0 × 96.0 × 63.0 mm");
    });

    test("follows the thickness through to the space inside", async ({ page }) => {
        await setNum(page, "Thickness", 6);
        await expect(stat(page, "Inside")).toContainText("108.0 × 78.0 × 54.0 mm");
    });
});

test.describe("lids", () => {
    test("opens as an open box — floor and four walls", async ({ page }) => {
        await expect(stat(page, "Parts")).toContainText("5");
    });

    test("adds a lid and a lip that clears the opening", async ({ page }) => {
        await panel(page).getByRole("combobox", { name: "Type" }).click();
        await page.getByRole("option", { name: /Lay-on lid/ }).click();
        await expect(stat(page, "Parts")).toContainText("7");
        await expect(page.getByTestId("statusbar")).toContainText("Parts");
        // The glue position for the lip is engraved, so the legend grows.
        await expect(page.locator("li", { hasText: "glue position" })).toHaveCount(1);
    });

    test("builds a clamshell with a pair of hinge ears", async ({ page }) => {
        await panel(page).getByRole("combobox", { name: "Type" }).click();
        await page.getByRole("option", { name: /Hinged lid/ }).click();
        // Base box, lid box and two ears.
        await expect(stat(page, "Parts")).toContainText("12");
        // Controls that only a hinge has.
        await expect(panel(page).getByRole("slider", { name: "Pin ⌀" })).toBeVisible();
        await expect(panel(page).getByRole("slider", { name: "Pivot behind" })).toBeVisible();
    });

    test("hides the lid's own controls when there is no lid", async ({ page }) => {
        await expect(panel(page).getByRole("slider", { name: "Lid height" })).toHaveCount(0);
        await expect(panel(page).getByRole("slider", { name: "Pin ⌀" })).toHaveCount(0);
    });
});

test.describe("joints", () => {
    test("keeps the box the size it was asked for whatever the fingers do", async ({ page }) => {
        await setNum(page, "Finger width", 20);
        await expect(stat(page, "Outside")).toContainText("120.0 × 90.0 × 60.0 mm");
        await expect(stat(page, "Fingers")).toContainText("20.0");
    });

    test("takes the floor off the ground and says what that costs", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "Inset" }).click();
        await setNum(page, "Inset by", 10);
        // 60 outer − 10 of plinth − 3 of floor.
        await expect(stat(page, "Inside")).toContainText("114.0 × 84.0 × 47.0 mm");
        await expect(stat(page, "Outside")).toContainText("60.0 mm");
    });

    test("warns when the kerf has been left at zero", async ({ page }) => {
        await setNum(page, "Kerf", 0);
        await expect(page.getByTestId("statusbar").getByRole("button", { name: /note/ })).toBeVisible();
    });
});

test.describe("dividers", () => {
    test("cuts a cross-lapped grid", async ({ page }) => {
        await openSection(page, "Dividers");
        await setNum(page, "Across the width", 2);
        await setNum(page, "Across the depth", 1);
        // Five for the box, three for the grid.
        await expect(stat(page, "Parts")).toContainText("8");
    });
});

test.describe("the sheet", () => {
    test("names the parts on the canvas, and can stop", async ({ page }) => {
        const canvas = page.getByTestId("stage-canvas");
        await expect(canvas.locator("text", { hasText: "Bottom" })).toHaveCount(1);
        await page.getByRole("button", { name: "Part names" }).click();
        await expect(canvas.locator("text")).toHaveCount(0);
    });

    test("lists every part with a note on what it is", async ({ page }) => {
        await page.getByTestId("statusbar").getByRole("button", { name: /Parts \(5\)/ }).click();
        const list = page.getByTestId("bottom-panel");
        await expect(list.getByText("Bottom", { exact: true })).toBeVisible();
        await expect(list.getByText(/corners are cut out/)).toBeVisible();
    });

    test("wraps the parts into rows no wider than the sheet", async ({ page }) => {
        await openSection(page, "Sheet");
        await setNum(page, "Sheet width", 200);
        // Two rows of panels rather than one long one: narrower than the sheet,
        // and taller than any single part.
        const s = (await stat(page, "Sheet").innerText()).replace("Sheet", ""),
            [w, h] = s.split("×").map(n => parseFloat(n));
        expect(w).toBeLessThanOrEqual(200);
        expect(h).toBeGreaterThan(150);
    });

    test("says so rather than dropping a part too big for the sheet", async ({ page }) => {
        await setNum(page, "Width", 500);
        await openSection(page, "Sheet");
        await setNum(page, "Sheet width", 200);
        await expect(page.getByTestId("statusbar").getByRole("button", { name: /note/ })).toBeVisible();
        await expect(stat(page, "Parts")).toContainText("5");
    });
});

test.describe("output", () => {
    test("writes an SVG named after the box", async ({ page }) => {
        const dl = await exportDefault(page);
        expect(dl.suggestedFilename()).toBe("box_120x90x60_3mm.svg");
    });

    test("writes a DXF with every panel in it", async ({ page }) => {
        const dl = await exportAs(page, /DXF/);
        expect(dl.suggestedFilename()).toBe("box_120x90x60_3mm.dxf");
    });

    test("leaves the part names out of the file", async ({ page }) => {
        const dl = await exportDefault(page),
            path = await dl.path(),
            fs = await import("node:fs/promises"),
            svg = await fs.readFile(path, "utf8");
        expect(svg).toContain("stroke=\"#ff0000\"");
        expect(svg).not.toContain("Bottom");
    });
});

test.describe("presets", () => {
    test("turns a box into a sorter in one click", async ({ page }) => {
        await page.getByTestId("sidebar").getByRole("button", { name: /Parts sorter/ }).click();
        await expect(stat(page, "Parts")).toContainText("8");
    });

    test("lands in the history like anything else", async ({ page }) => {
        await page.getByTestId("sidebar").getByRole("button", { name: /Hinged case/ }).click();
        await expect(stat(page, "Parts")).toContainText("12");
        await page.getByTestId("toolbar").getByRole("button", { name: "Undo" }).click();
        await expect(stat(page, "Parts")).toContainText("5");
    });
});
