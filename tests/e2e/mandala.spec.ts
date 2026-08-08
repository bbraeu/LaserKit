import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

// The mandala in a real browser. The geometry is pinned in
// tests/unit/mandala.test.ts; what is checked here is that the one number
// worth putting in front of somebody actually reaches them before they cut.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "mandala");
    await waitForDrawing(page);
});

test("draws a disc before anything is asked of it", async ({ page }) => {
    await expect(page.getByTestId("empty-drop")).toHaveCount(0);
    await expect(stat(page, "Diameter")).toContainText("120 mm");
    // Sixteen-fold, four rings.
    await expect(stat(page, "Motifs")).toContainText("64");
});

test("multiplies the motifs by the symmetry and the rings", async ({ page }) => {
    await setNum(page, "Symmetry", 8);
    await expect(stat(page, "Motifs")).toContainText("32");
    await setNum(page, "Rings", 5);
    await expect(stat(page, "Motifs")).toContainText("40");
});

test("narrows the web as the symmetry rises", async ({ page }) => {
    const web = async () => Number((await stat(page, "Web").innerText()).replace(/[^\d.]/g, ""));
    await setNum(page, "Symmetry", 6);
    const wide = await web();
    await setNum(page, "Symmetry", 32);
    await expect.poll(web).toBeLessThan(wide);
});

test("says so when a cut mandala would fall to pieces", async ({ page }) => {
    await panel(page).getByRole("radio", { name: "Cut through" }).click();
    await setNum(page, "Symmetry", 48);
    await setNum(page, "Between motifs", 0.05);
    await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("off the bed in");
});

test("says nothing about the web while it is only being engraved", async ({ page }) => {
    await setNum(page, "Symmetry", 48);
    await setNum(page, "Between motifs", 0.05);
    await expect(page.getByTestId("statusbar")).not.toContainText("off the bed in");
});

test("hides the seed unless the motifs are mixed", async ({ page }) => {
    await expect(page.getByLabel("Seed, exact value")).toBeVisible();
    await panel(page).getByRole("combobox", { name: "Motif" }).click();
    await page.getByRole("option", { name: "Petals", exact: true }).click();
    await expect(page.getByLabel("Seed, exact value")).toHaveCount(0);
});

test("writes the disc in all three formats", async ({ page }) => {
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("mandala_120mm_16x4_1.svg");
    for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
        const dl = await exportAs(page, new RegExp(`^${label}`));
        expect(dl.suggestedFilename()).toBe(`mandala_120mm_16x4_1.${ext}`);
    }
});

test.describe("the composed motifs", () => {
    // Seventeen shapes that are an assembly rather than one curve. What is
    // worth checking in a browser is only that the picker reaches every one of
    // them and that each really draws something different — the geometry is
    // pinned in tests/unit/mandala.test.ts, where the neighbouring slot can be
    // measured.
    const NAMES = [
        "Rosettes", "Stars (5)", "Stars (8)", "Squares", "Hexagons", "Small circles",
        "Arrows", "Paisley", "Crescents", "Chevrons", "Greek key",
        "Spirals", "S-curves", "Vines & leaves", "Lattice", "Line focus", "Radiating axes"
    ];

    const pick = async (page: Page, name: string): Promise<void> => {
        await panel(page).getByRole("combobox", { name: "Motif" }).click();
        await page.getByRole("option", { name, exact: true }).click();
    };

    test("are all in the picker and all draw something", async ({ page }) => {
        const paint = () => page.getByTestId("stage-canvas").locator("svg").innerHTML();
        const seen = new Set<string>();
        let prev = await paint();
        for (const name of NAMES) {
            await pick(page, name);
            // Wait for the drawing to actually change. Polling for "a path with
            // some length in it" would be satisfied by the *previous* motif,
            // because the build is debounced — which reads as two motifs
            // drawing the same thing.
            await expect.poll(async () => (await paint()) !== prev, { timeout: 15000 }).toBe(true);
            // And the whole string, not a prefix: several motifs share their
            // first few thousand characters, since the ring lines and the outer
            // circle are written before any of the pattern is.
            prev = await paint();
            seen.add(prev);
        }
        expect(seen.size).toBe(NAMES.length);
    });

    test("counts a whole rosette as one motif, not seven", async ({ page }) => {
        // A rosette is six petals and a middle. Counting rings would say a
        // mandala had seven times as many motifs the moment you picked it,
        // which is not a thing anybody means by the word.
        const count = async () => (await stat(page, "Motifs").innerText()).replace(/\D+/g, "");
        await pick(page, "Petals");
        const one = await count();
        expect(one).not.toBe("");
        await pick(page, "Rosettes");
        await expect.poll(count).toBe(one);
    });

    test("still warns when one of them would fall to pieces cut", async ({ page }) => {
        await pick(page, "Rosettes");
        await panel(page).getByRole("radio", { name: "Cut through" }).click();
        await setNum(page, "Symmetry", 48);
        await setNum(page, "Between motifs", 0.05);
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText("off the bed in");
    });
});

test.describe("composing a stack", () => {
    // The one place this tool breaks its own rule about a control per ring. It
    // earns it: a mandala worth cutting is stacked, and that is a decision per
    // ring which nothing else can express.
    const stack = (page: Page) => panel(page).getByRole("button", { name: "Rings, one by one" });

    test("is offered only when the motifs are mixed", async ({ page }) => {
        await expect(stack(page)).toBeVisible();
        await panel(page).getByRole("combobox", { name: "Motif" }).click();
        await page.getByRole("option", { name: "Petals", exact: true }).click();
        await expect(stack(page)).toHaveCount(0);
    });

    test("arrives filled in from the seed rather than empty", async ({ page }) => {
        // Twenty-five empty dropdowns would be a worse tool than no dropdowns.
        await stack(page).click();
        const aRing = panel(page).getByRole("combobox", { name: /ring$|^Ring / });
        await expect(aRing).toHaveCount(4);
        for (const name of ["Innermost ring", "Outermost ring"]) {
            await expect(panel(page).getByRole("combobox", { name })).not.toHaveText("");
        }
    });

    test("changes one ring and freezes the rest", async ({ page }) => {
        await stack(page).click();
        await panel(page).getByRole("combobox", { name: "Innermost ring" }).click();
        await page.getByRole("option", { name: "Greek key", exact: true }).click();
        await expect(panel(page).getByRole("combobox", { name: "Innermost ring" })).toContainText("Greek key");

        // The seed no longer owns the others: nudging it must leave them alone.
        const outer = await panel(page).getByRole("combobox", { name: "Outermost ring" }).innerText();
        await page.getByLabel("Seed, exact value").fill("777");
        await page.getByLabel("Seed, exact value").blur();
        await expect(panel(page).getByRole("combobox", { name: "Outermost ring" })).toHaveText(outer);
        await expect(panel(page).getByRole("combobox", { name: "Innermost ring" })).toContainText("Greek key");
    });

    test("hands the rings back to the seed on request", async ({ page }) => {
        await stack(page).click();
        await panel(page).getByRole("combobox", { name: "Innermost ring" }).click();
        await page.getByRole("option", { name: "Greek key", exact: true }).click();
        await panel(page).getByRole("button", { name: "Back to the seed" }).click();
        await expect(panel(page).getByRole("button", { name: "Back to the seed" })).toHaveCount(0);
    });
});

test("gives a band of dots less room than a band of rosettes", async ({ page }) => {
    // Equal bands are what most made a generated mandala look generated. The
    // check that it reaches the browser at all: the drawing has to change when
    // only the motif in one ring changes.
    await panel(page).getByRole("combobox", { name: "Motif" }).click();
    await page.getByRole("option", { name: "Dots", exact: true }).click();
    const dots = await page.getByTestId("stage-canvas").locator("svg").innerHTML();
    await panel(page).getByRole("combobox", { name: "Motif" }).click();
    await page.getByRole("option", { name: "Rosettes", exact: true }).click();
    await expect.poll(async () => (await page.getByTestId("stage-canvas").locator("svg").innerHTML()) !== dots).toBe(true);
});
