import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, exportExtra, openTool, setNumber, stat, waitForDrawing } from "./helpers";

// The tree of life in a real browser. All of the geometry is pinned in
// tests/unit/celtic.test.ts, where the disc can be measured properly — the
// builder is pure now, so there is a great deal less that only exists here than
// there used to be. What is left is the half that is genuinely the browser's:
// that the controls are wired to the parameters they claim, that changing one
// changes the drawing, that the engraved layer reaches the canvas as its own
// colour, and that the three files come out named after what is on screen.

const panel = (page: Page) => page.getByTestId("inspector");

const paint = (page: Page) => page.getByTestId("stage-canvas").locator("svg");

/** A status-bar figure with its own label stripped off — see below. */
const figure = (page: Page, label: string) => async (): Promise<string> =>
    (await stat(page, label).innerText()).replace(new RegExp(`^${label}\\s*`), "").trim();

/**
 * Wait for the drawing to *change*.
 *
 * The build is debounced, so polling for a path merely finds the previous one:
 * every assertion about a control doing something has to hold on to what was
 * there before and wait for it to stop being that.
 */
const changes = async (page: Page, act: () => Promise<void>): Promise<string> => {
    const before = await paint(page).innerHTML();
    await act();
    await expect.poll(async () => (await paint(page).innerHTML()) !== before, { timeout: 20000 }).toBe(true);
    return paint(page).innerHTML();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "celtic");
    await waitForDrawing(page);
});

test("draws a tree in a plaited ring before anything is asked of it", async ({ page }) => {
    await expect(page.getByTestId("empty-drop")).toHaveCount(0);
    await expect(stat(page, "Diameter")).toContainText("150 mm");
    // Five primaries forking in two, four levels deep, plus the roots — and
    // every one of them is a limb in the drawing rather than a number in the
    // panel.
    await expect.poll(async () => Number(await figure(page, "Branches")())).toBeGreaterThan(50);
    // The one thing the canvas cannot show you: whether it is actually one
    // piece of material.
    await expect.poll(figure(page, "One piece")).toBe("yes");
});

test("cuts the leaves it can and engraves the ones it cannot", async ({ page }) => {
    // The rule that makes a canopy a canopy instead of a blob. A leaf lying
    // across a branch or across its neighbour would lose its own outline in the
    // union, so it goes onto the green layer instead — which means the drawing
    // has both colours in it, and neither of them is there when the leaves are
    // switched off.
    const leaves = await figure(page, "Leaves")();
    expect(leaves).toMatch(/^\d+ cut · \d+ engraved$/);
    const [cut, engraved] = leaves.match(/\d+/g)!.map(Number);
    expect(cut).toBeGreaterThan(0);
    expect(engraved).toBeGreaterThan(0);

    expect(await paint(page).innerHTML()).toContain("#00a000");
    expect(await paint(page).innerHTML()).toContain("#ff0000");

    const bare = await changes(page, async () => {
        await page.getByRole("switch", { name: "Leaves", exact: true }).click();
    });
    expect(bare).not.toContain("#00a000");
    expect(bare).toContain("#ff0000");
    await expect.poll(figure(page, "Leaves")).toBe("0 cut · 0 engraved");
});

test("spreads more leaves over the tree rather than piling them up", async ({ page }) => {
    const total = async (): Promise<number> =>
        (await figure(page, "Leaves")()).match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    const few = await total();
    await setNumber(page, "Leaf count", 12);
    await expect.poll(total).toBe(12);
    await setNumber(page, "Leaf count", 60);
    await expect.poll(total).toBeGreaterThan(few);
});

test("grows the tree with the depth", async ({ page }) => {
    // innerText keeps the label and a newline while toHaveText normalises, so
    // the two are never compared against each other here — both sides of this
    // go through the same stripped reading.
    const branches = figure(page, "Branches");
    const few = Number(await branches());
    await setNumber(page, "Branch depth", 5);
    await expect.poll(async () => Number(await branches())).toBeGreaterThan(few);
});

test("takes ten primaries, which the old five-way limit would not", async ({ page }) => {
    const branches = figure(page, "Branches");
    const few = Number(await branches());
    await setNumber(page, "Branch density", 10);
    await expect.poll(async () => Number(await branches())).toBeGreaterThan(few);
    // And it is still one piece at the top of the range, which is the whole
    // reason the ceiling is ten rather than twenty.
    await expect.poll(figure(page, "One piece")).toBe("yes");
});

test("holds the trunk and the branches apart as two controls", async ({ page }) => {
    // They used to be one number: every branch was a fraction of the trunk, so
    // a heavy trunk under fine branches could not be drawn at all.
    const twig = async (): Promise<number> => Number((await figure(page, "Thinnest twig")()).replace(" mm", ""));
    const before = await twig();
    // A much heavier trunk redraws the tree and leaves the twigs where they
    // were — not to the micron, because moving the trunk moves where the roots
    // leave it, but nowhere near the width of a slider step.
    await changes(page, () => setNumber(page, "Trunk thickness", 24));
    await expect.poll(twig).toBeLessThan(before * 1.25);
    // The branch control is what moves them.
    await changes(page, () => setNumber(page, "Branch thickness", 14));
    await expect.poll(twig).toBeGreaterThan(before * 1.6);
});

test.describe("the knot", () => {
    test("redraws the plait for every loop count and reports the strand it left", async ({ page }) => {
        // The strand is the ring width divided by three with the gap taken out
        // of it, and it is the figure that says whether the edge of the piece
        // is a band or a wire.
        const seen = new Set<string>();
        for (const loops of [6, 12, 20]) {
            seen.add(await changes(page, () => setNumber(page, "Knot density", loops)));
        }
        expect(seen.size).toBe(3);

        const strand = figure(page, "Strand");
        const wide = await strand();
        await changes(page, () => setNumber(page, "Braid gap", 3));
        await expect.poll(async () => Number((await strand()).replace(" mm", ""))).toBeLessThan(
            Number(wide.replace(" mm", ""))
        );
    });

    test("says when the plait is asked for more loops than the band can hold", async ({ page }) => {
        // The ceiling follows the circumference: a strand sweeps the whole band
        // twice per loop, so past a point consecutive passes merge and the
        // whitespace that makes it a plait closes up.
        await expect(page.getByTestId("statusbar")).not.toContainText(/\d note/);
        await changes(page, () => setNumber(page, "Knot density", 40));
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText("held to");
    });

    test("widens the band without letting anything out of the disc", async ({ page }) => {
        await changes(page, () => setNumber(page, "Ring width", 24));
        await expect.poll(figure(page, "One piece")).toBe("yes");
        await expect(page.getByTestId("statusbar")).not.toContainText("past the edge of the disc");
    });
});

test("grows another tree from the regenerate button", async ({ page }) => {
    // The seed is the whole of the tool's memory, so the button has to actually
    // move it — and the drawing has to follow.
    const before = await panel(page).getByLabel("Seed, exact value").inputValue();
    await changes(page, () => panel(page).getByTestId("celtic-regenerate").click());
    expect(await panel(page).getByLabel("Seed, exact value").inputValue()).not.toBe(before);
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
});

test("writes the tree in all three formats", async ({ page }) => {
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("celtic_tree_150mm_5x4_1.svg");
    for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
        const dl = await exportAs(page, new RegExp(`^${label}`));
        expect(dl.suggestedFilename()).toBe(`celtic_tree_150mm_5x4_1.${ext}`);
    }
});
