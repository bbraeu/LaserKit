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
    await setNum(page, "Web", 0.05);
    await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("off the bed in");
});

test("says nothing about the web while it is only being engraved", async ({ page }) => {
    await setNum(page, "Symmetry", 48);
    await setNum(page, "Web", 0.05);
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
    // Seven shapes that are an assembly rather than one curve. What is worth
    // checking in a browser is only that the picker reaches them and that each
    // really draws something different — the geometry is pinned in
    // tests/unit/mandala.test.ts, where the neighbouring slot can be measured.
    const NAMES = ["Rosettes", "Stars", "Arrows", "Paisley", "Crescents", "Chevrons", "Greek key"];

    const pick = async (page: Page, name: string): Promise<void> => {
        await panel(page).getByRole("combobox", { name: "Motif" }).click();
        await page.getByRole("option", { name, exact: true }).click();
    };

    test("are all in the picker and all draw something", async ({ page }) => {
        const seen = new Set<string>();
        for (const name of NAMES) {
            await pick(page, name);
            await expect.poll(async () => {
                const d = await page.getByTestId("stage-canvas").locator("svg path").first().getAttribute("d");
                return d?.length ?? 0;
            }).toBeGreaterThan(200);
            seen.add((await page.getByTestId("stage-canvas").locator("svg").innerHTML()).slice(0, 4000));
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
        await setNum(page, "Web", 0.05);
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText("off the bed in");
    });
});
