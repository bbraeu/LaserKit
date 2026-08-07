import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

// The living hinge, in a real browser.
//
// The field of slits is pinned in tests/unit/hinge.test.ts, where it can be
// measured. What only a browser shows is the wiring: this tool has no file to
// open, so a panel that stops reaching the builder leaves the last hinge on the
// stage looking perfectly correct — and its two most important readouts are
// numbers the builder derives rather than anything you can see in the drawing.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

/** A status-bar figure, once it has stopped moving. */
const settledStat = async (page: Page, label: string): Promise<string> => {
    let last = "";
    await expect.poll(async () => {
        const now = await stat(page, label).innerText(),
            same = now === last && now.length > label.length;
        last = now;
        return same;
    }).toBe(true);
    return last;
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "hinge");
    await waitForDrawing(page);
});

test.describe("a panel that bends", () => {
    test("cuts a field of slits before anything is asked of it", async ({ page }) => {
        await expect(page.getByTestId("empty-drop")).toHaveCount(0);
        await expect(page.getByTestId("toolbar").getByRole("button", { name: "Open" })).toHaveCount(0);
        await expect(stat(page, "Rows")).toContainText("24");
        await expect(stat(page, "Panel")).toContainText("120 × 80 mm");
    });

    test("closes the rows up when the spacing is tightened", async ({ page }) => {
        await setNum(page, "Row spacing", 2.5);
        await expect(stat(page, "Rows")).toContainText("48");
        // Twice the rows is half the twist each of them has to take.
        await expect(stat(page, "Twist / row")).toContainText("3.6°");
    });

    test("reports the twist as the spacing over the radius, exactly", async ({ page }) => {
        // 5 mm rows on a 40 mm radius: 0.125 rad, 7.2°.
        await expect(stat(page, "Twist / row")).toContainText("7.2°");
        await setNum(page, "Radius", 80);
        await expect(stat(page, "Twist / row")).toContainText("3.6°");
    });

    test("takes the beam off the link and says what is left", async ({ page }) => {
        // 5 mm set, 0.15 mm of beam through both ends of it.
        await expect(stat(page, "Link")).toContainText("4.8");
        await setNum(page, "Kerf", 0.5);
        await expect(stat(page, "Link")).toContainText("4.5");
    });

    test("says so when the links will not survive the bend", async ({ page }) => {
        await setNum(page, "Radius", 5);
        await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText(/shear through every link/);
    });
});

test.describe("the pattern", () => {
    test("swaps a straight slit for a wave, and gains the depth control", async ({ page }) => {
        await expect(panel(page).getByRole("slider", { name: "Wave depth" })).toHaveCount(0);
        await panel(page).getByRole("combobox", { name: "Cut" }).click();
        await page.getByRole("option", { name: "Wave" }).click();
        await expect(panel(page).getByRole("slider", { name: "Wave depth" })).toHaveCount(1);
        // A wave is a longer cut over the same field.
        await expect(stat(page, "Cut")).toBeVisible();
    });

    test("adds bars across the slit ends", async ({ page }) => {
        const before = await settledStat(page, "Cut");
        await panel(page).getByRole("combobox", { name: "Cut" }).click();
        await page.getByRole("option", { name: "T-ends" }).click();
        await expect.poll(async () => settledStat(page, "Cut")).not.toBe(before);
    });

    test("keeps the pattern in a band when the ends have to stay flat", async ({ page }) => {
        const before = await settledStat(page, "Rows");
        await setNum(page, "Flat ends", 30);
        // Sixty of the 120 mm is now uncut, so half the rows are gone.
        await expect.poll(async () => settledStat(page, "Rows")).not.toBe(before);
        await expect(stat(page, "Panel")).toContainText("120 × 80 mm");
    });
});

test.describe("the exports", () => {
    test("write the panel in all three formats", async ({ page }) => {
        const svg = await exportDefault(page);
        expect(svg.suggestedFilename()).toBe("hinge_120x80_straight.svg");
        for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
            const dl = await exportAs(page, new RegExp(`^${label}`));
            expect(dl.suggestedFilename()).toBe(`hinge_120x80_straight.${ext}`);
        }
    });

    test("leave the outline out when the panel belongs to something else", async ({ page }) => {
        await page.getByRole("switch", { name: "Cut the outline" }).click();
        const src = await (await exportDefault(page)).createReadStream()
            .then(s => new Response(s as unknown as ReadableStream).text());
        // Every path is an open slit; nothing closes.
        expect(src).not.toContain("Z");
    });
});

test.describe("presets", () => {
    test("cut a test strip, which is the honest answer to every question here", async ({ page }) => {
        await page.getByRole("button", { name: /Test strip/ }).click();
        await expect(stat(page, "Panel")).toContainText("40 × 60 mm");
    });
});
