import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { svgTwoOperations } from "./fixtures";
import { exportAs, exportDefault, openFile, openTool, stat, waitForDrawing } from "./helpers";

// Nesting, in a real browser.
//
// The arithmetic is pinned in tests/unit/nest.test.ts. What only a browser can
// show is the half of the tool that is not arithmetic: reading a design's
// colours back out of an SVG through the browser's own style resolution, and
// keeping them apart all the way to a file. jsdom has neither a getCTM nor a
// computed style worth the name, so this is the only place it can be checked.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

/** A PairField's boxes are named plainly — there is no slider beside them. */
const setPair = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: label, exact: true });
    await field.fill(String(value));
    await field.blur();
};

const settled = async (page: Page, label: string): Promise<string> => {
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
    await openTool(page, "nest");
    await openFile(page, svgTwoOperations());
    await waitForDrawing(page);
});

test.describe("laying a sheet out", () => {
    test("fills the sheet and says how many that is", async ({ page }) => {
        // A 30 × 20 design, 3 mm apart, 5 mm clear of a 400 mm square:
        // (390+3)/33 = 11 across, (390+3)/23 = 17 down.
        await expect(stat(page, "Grid")).toContainText("11 × 17");
        await expect(stat(page, "Copies")).toContainText("187");
        await expect(stat(page, "Sheets")).toContainText("1");
    });

    test("lays out a set number instead, and counts the sheets it would take", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "A set number" }).click();
        await setNum(page, "How many", 24);
        await expect(stat(page, "Copies")).toContainText("24");
        await expect(stat(page, "Sheets")).toContainText("1");
    });

    test("fits fewer as the gap and the margin grow", async ({ page }) => {
        const before = await settled(page, "Copies");
        await setNum(page, "Gap", 20);
        await expect.poll(async () => settled(page, "Copies")).not.toBe(before);
        const wide = Number((await stat(page, "Copies").innerText()).replace(/\D/g, ""));
        await setNum(page, "Margin", 40);
        await expect.poll(async () =>
            Number((await stat(page, "Copies").innerText()).replace(/\D/g, ""))).toBeLessThan(wide);
    });

    test("says so when not one copy fits", async ({ page }) => {
        await setPair(page, "Width", 20);
        await setPair(page, "Height", 20);
        await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText("not one copy fits");
    });
});

test.describe("the operations", () => {
    test("reads the design's colours and keeps them apart", async ({ page }) => {
        // The whole point of the tool. Both operations are named on the stage's
        // legend, which is the only place a colour is given a name.
        const legend = page.getByLabel("Colours in this drawing");
        await expect(legend.getByText("line cutting")).toBeVisible();
        await expect(legend.getByText("surface engraving")).toBeVisible();
    });

    test("carries both into the DXF, in the colours software groups on", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "A set number" }).click();
        await setNum(page, "How many", 4);

        const dxf = await exportAs(page, /^DXF/);
        const src = await dxf.createReadStream()
            .then(s => new Response(s as unknown as ReadableStream).text());
        // 1 is the cut colour, 5 surface engraving.
        expect(src).toContain("\r\n62\r\n1\r\n");
        expect(src).toContain("\r\n62\r\n5\r\n");
    });

    test("leaves the sheet guide out of the file", async ({ page }) => {
        // It is where the material is, not something to burn. Cutting it would
        // cut the material out of the material.
        const src = await (await exportDefault(page)).createReadStream()
            .then(s => new Response(s as unknown as ReadableStream).text());
        expect(src).not.toContain("stroke-dasharray");
        expect(src).not.toContain("#7c8798");
    });

    test("names the export after the design and the count", async ({ page }) => {
        await panel(page).getByRole("radio", { name: "A set number" }).click();
        await setNum(page, "How many", 6);
        const svg = await exportDefault(page);
        expect(svg.suggestedFilename()).toBe("blank_x6.svg");
    });
});

test.describe("the sheet", () => {
    test("is what the drawing is sized to", async ({ page }) => {
        await setPair(page, "Width", 200);
        await setPair(page, "Height", 150);
        const src = await (await exportDefault(page)).createReadStream()
            .then(s => new Response(s as unknown as ReadableStream).text());
        expect(src).toContain('width="200mm"');
        expect(src).toContain('height="150mm"');
    });

    test("takes a design handed over by another tool", async ({ page }) => {
        await openTool(page, "text");
        await expect(page.getByTestId("stage-canvas").locator("svg")).toBeVisible();
        await page.getByTestId("send-to").click();
        await page.getByRole("menuitem", { name: /Nest/ }).click();
        await expect(page).toHaveURL(/\/nest\/$/);
        await expect(page.getByTestId("sidebar")).toContainText("from Text");
        await expect(stat(page, "Copies")).toBeVisible();
    });
});
