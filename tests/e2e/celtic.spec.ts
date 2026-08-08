import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, exportExtra, openTool, setNumber, stat, waitForDrawing } from "./helpers";

// The tree of life in a real browser. The geometry is pinned in
// tests/unit/celtic.test.ts, where the disc can be measured; what cannot be
// checked there is the half of this tool that only exists in a browser — the
// cut layer is a *raster union*, painted onto a canvas and traced once, so
// there is no drawing at all without a DOM. Everything below is therefore
// really one question asked five ways: did the union come out, and does it
// change when it should.

const panel = (page: Page) => page.getByTestId("inspector");

const paint = (page: Page) => page.getByTestId("stage-canvas").locator("svg");

/** A status-bar figure with its own label stripped off — see below. */
const figure = (page: Page, label: string) => async (): Promise<string> =>
    (await stat(page, label).innerText()).replace(new RegExp(`^${label}\\s*`), "").trim();

const pickBorder = async (page: Page, name: string): Promise<void> => {
    await panel(page).getByRole("combobox", { name: "Style" }).click();
    await page.getByRole("option", { name, exact: true }).click();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "celtic");
    await waitForDrawing(page);
});

test("draws a tree before anything is asked of it", async ({ page }) => {
    await expect(page.getByTestId("empty-drop")).toHaveCount(0);
    await expect(stat(page, "Diameter")).toContainText("150 mm");
    // Five primaries off the trunk, forking in two four levels deep, and every
    // one of them is a limb in the drawing rather than a number in the panel.
    await expect.poll(async () => Number(await figure(page, "Branches")())).toBeGreaterThan(50);
    await expect.poll(async () => Number(await figure(page, "Leaves")())).toBeGreaterThan(10);
});

test("absorbs the leaves into the branches instead of cutting round them", async ({ page }) => {
    // The whole point of the tool, and the one consequence of it that can be
    // seen from outside. Every leaf sits *on* a twig, so drawn as outlines each
    // one would be another closed cut line crossing the branch it grows from —
    // a hundred and eighty more paths, and a hundred and eighty places for the
    // beam to cut the twig off. Painted into the union they add none: the leaf
    // and the twig are one shape.
    const withLeaves = Number(await figure(page, "Cut paths")()),
        leaves = Number(await figure(page, "Leaves")());
    expect(leaves).toBeGreaterThan(10);

    await page.getByRole("switch", { name: "Leaves", exact: true }).click();
    await expect.poll(figure(page, "Leaves")).toBe("0");
    const without = Number(await figure(page, "Cut paths")());
    expect(Math.abs(withLeaves - without)).toBeLessThan(leaves);
});

test("grows the tree with the depth", async ({ page }) => {
    // innerText keeps the label and a newline while toHaveText normalises, so
    // the two are never compared against each other here — both sides of this
    // go through the same stripped reading.
    const branches = figure(page, "Branches");
    const few = Number(await branches());
    await setNumber(page, "Depth", 5);
    await expect.poll(async () => Number(await branches())).toBeGreaterThan(few);
});

test.describe("the border", () => {
    test("draws a different one for every style", async ({ page }) => {
        // Plain, braid, rope and knot all cut the same band — what differs is
        // what is engraved into it, and that is a separate layer that must
        // never end up in the union, or the band would come out with holes in
        // it and stop being a band.
        //
        // Which is exactly why this compares the *whole* drawing rather than a
        // prefix of it. The cut band is written first and is identical for all
        // four, so the first few thousand characters say the styles are the
        // same — and the engraved layer that actually differs comes after.
        const seen = new Set<string>();
        let prev = await paint(page).innerHTML();
        for (const name of ["Plain", "Braid", "Rope", "Knot"]) {
            await pickBorder(page, name);
            // The build is debounced, so wait for the drawing to change rather
            // than for it merely to exist.
            await expect.poll(async () => (await paint(page).innerHTML()) !== prev, { timeout: 15000 }).toBe(true);
            prev = await paint(page).innerHTML();
            seen.add(prev);
        }
        expect(seen.size).toBe(4);
    });

    test("engraves the decoration and cuts everything else", async ({ page }) => {
        await pickBorder(page, "Knot");
        await expect.poll(async () => (await paint(page).innerHTML()).includes("#00a000")).toBe(true);
        expect(await paint(page).innerHTML()).toContain("#ff0000");
        // A plain band has nothing burnt into it, so there is nothing green.
        await pickBorder(page, "Plain");
        await expect.poll(async () => (await paint(page).innerHTML()).includes("#00a000")).toBe(false);
    });

    test("drops the width control and says why when there is no ring", async ({ page }) => {
        await pickBorder(page, "None");
        await expect(panel(page).getByRole("slider", { name: "Border width" })).toHaveCount(0);
        await expect(panel(page)).toContainText("end in mid-air");
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText("end in mid-air");
    });
});

test.describe("the base", () => {
    test("opens with the feet drawn under the canvas and offered as a file", async ({ page }) => {
        await expect(page.getByTestId("feet-preview")).toBeVisible();
        await expect(page.getByTestId("bottom-panel")).toContainText("slot is the sheet");
        // A companion file: nobody cuts the disc with tabs on it and then has
        // nothing to stand it in.
        const dl = await exportExtra(page, "feet");
        expect(dl.suggestedFilename()).toMatch(/_feet\.svg$/);
    });

    test("takes the feet away with the tabs", async ({ page }) => {
        await page.getByRole("switch", { name: "Tabs and feet" }).click();
        await expect(page.getByTestId("feet-preview")).toHaveCount(0);
        await expect(page.getByTestId("export-extra-feet")).toHaveCount(0);
    });

    test("offers a plain disc to stand behind it", async ({ page }) => {
        // The openwork shows whatever is behind it. This is the one companion
        // piece that costs nothing to work out, so it is offered rather than
        // left as an exercise.
        await expect(page.getByTestId("export-extra-backing")).toHaveCount(0);
        await page.getByRole("switch", { name: "Backing disc" }).click();
        const dl = await exportExtra(page, "backing");
        expect(dl.suggestedFilename()).toMatch(/_backing\.svg$/);
    });
});

test("grows a leaf that was asked for too small, and says so", async ({ page }) => {
    // The floor is enforced rather than suggested: under about 4 mm a cut leaf
    // is a hole the size of the beam plus its own char, and a canopy of them is
    // a grey smudge. Nothing on the canvas shows that at this zoom.
    await expect(page.getByTestId("statusbar")).not.toContainText(/\d note/);
    await setNumber(page, "Leaf size", 2);
    await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("scorch marks");
    await expect.poll(figure(page, "Leaf size")).toBe("4.0 mm");
});

test("writes the tree in all three formats", async ({ page }) => {
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("celtic_tree_150mm_5x4_1.svg");
    for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
        const dl = await exportAs(page, new RegExp(`^${label}`));
        expect(dl.suggestedFilename()).toBe(`celtic_tree_150mm_5x4_1.${ext}`);
    }
});
