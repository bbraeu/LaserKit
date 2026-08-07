import { expect, test } from "@playwright/test";
import { pngDisc, pngStrokes, svgNoSize, svgOneItem, svgTwoItems, xcsProject } from "./fixtures";
import { exportAs, exportDefault, exportExtra, openFile, openTool, stat, waitForDrawing } from "./helpers";

// Every feature the four tools had before the redesign, exercised through the
// new UI. Anything that used to be a button in a header or a checkbox under a
// preview has to still be reachable and still do the same thing — that is the
// "no functionality removed" promise, and this is where it is kept.

test.describe("stamp creator", () => {
    test.beforeEach(async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);
    });

    test("opens at a named 50 mm size, with the plate cut out", async ({ page }) => {
        // A stamp is ordered at a size, so naming one is the default. The height
        // follows the design's proportions: 36 × 21 plus a 3 mm margin is 42 × 27,
        // scaled to 50 wide.
        await expect(page.getByRole("switch", { name: "Set the size" })).toBeChecked();
        await expect(stat(page, "Size")).toContainText("50.0 mm × 32.1 mm");
        await expect(stat(page, "Engraved")).toContainText("%");
        await expect(page.getByTestId("inspector")).toContainText("50.0 mm × 32.1 mm");

        // …and the same file frees it from the sheet.
        await expect(page.getByRole("switch", { name: "Cut the plate out" })).toBeChecked();
        await expect(page.locator("li", { hasText: "cut line" })).toBeVisible();
    });

    test("lets the design decide the plate once the size is let go of", async ({ page }) => {
        await page.getByRole("switch", { name: "Set the size" }).click();
        // 36 × 21 plus the 3 mm default margin.
        await expect(stat(page, "Size")).toContainText("42.0 mm × 27.0 mm");

        const margin = page.getByLabel("Margin, exact value");
        await margin.fill("10");
        await margin.blur();
        await expect(stat(page, "Size")).toContainText("56.0 mm × 41.0 mm");
    });

    test("keeps the plate at the named size and shrinks the artwork instead", async ({ page }) => {
        const margin = page.getByLabel("Margin, exact value");
        await margin.fill("10");
        await margin.blur();
        // With the size fixed, more margin means less artwork — not a bigger plate.
        await expect(stat(page, "Size")).toContainText("50.0 mm");
    });

    test("changes the plate shape", async ({ page }) => {
        await page.getByRole("radio", { name: "Circle" }).click();
        // A circle round a 36 × 21 design reaches its far corner, so it is square.
        const size = await stat(page, "Size").innerText();
        const [w, h] = size.replace("Size", "").split("×").map(s => parseFloat(s));
        expect(w).toBeCloseTo(h!, 1);
    });

    test("hides the corner radius for shapes that have no corners", async ({ page }) => {
        await expect(page.getByRole("slider", { name: "Corner radius" })).toBeVisible();
        await page.getByRole("radio", { name: "Circle" }).click();
        await expect(page.getByRole("slider", { name: "Corner radius" })).toHaveCount(0);
    });

    test("retypes the size and refits the canvas to it", async ({ page }) => {
        await page.getByRole("button", { name: "Zoom in", exact: true }).click();
        await expect(page.getByTestId("statusbar")).toContainText("140 %");

        const w = page.getByLabel("Width", { exact: true });
        await w.fill("150");
        await w.blur();

        await expect(stat(page, "Size")).toContainText("150.0 mm");
        // A stamp three times the size is a different object; the view goes back
        // to fitting it rather than leaving you zoomed into a corner.
        await expect(page.getByTestId("statusbar")).toContainText("100 %");
    });

    test("names the height outright when the proportions are not wanted", async ({ page }) => {
        const h = page.getByLabel("Height", { exact: true });
        await h.fill("50");
        await h.blur();
        await expect(stat(page, "Size")).toContainText("50.0 mm × 50.0 mm");
    });

    test("mirrors the design without moving the plate", async ({ page }) => {
        await page.getByLabel("Orientation").click();
        await page.getByRole("option", { name: "Mirror ↔" }).click();
        // The design flips about its own centre; the plate stays exactly where
        // it was, which is the whole point of mirroring for a stamp.
        await expect(stat(page, "Size")).toContainText("50.0 mm × 32.1 mm");
    });

    test("drops the cut line when the plate is not to be freed", async ({ page }) => {
        await expect(page.locator("li", { hasText: "cut line" })).toBeVisible();
        await page.getByRole("switch", { name: "Cut the plate out" }).click();
        await expect(page.locator("li", { hasText: "cut line" })).toHaveCount(0);
    });

    test("exports the stamp face in all three formats", async ({ page }) => {
        for (const [label, ext] of [["SVG", "svg"], ["DXF", "dxf"], ["FDS", "fds"]] as const) {
            const dl = await exportAs(page, new RegExp(`^${label}`));
            expect(dl.suggestedFilename()).toBe(`badge_inverted.${ext}`);
        }
    });

    test("exports the base plate and handle from its own toolbar button", async ({ page }) => {
        const dl = await exportExtra(page, "parts");
        expect(dl.suggestedFilename()).toBe("badge_stamp_parts.svg");
    });

    test("takes the layer count from the sheet on the bench", async ({ page }) => {
        const inspector = page.getByTestId("inspector");
        // A 20 mm grip is seven layers of 3 mm ply…
        await expect(inspector).toContainText("7 layers × 3.0 mm = 21.0 mm");

        const thickness = page.getByLabel("Material thickness in millimetres");
        await thickness.fill("6");
        await thickness.blur();
        // …and three of 6 mm acrylic.
        await expect(inspector).toContainText("3 layers × 6.0 mm = 18.0 mm");
    });

    test("offers several handles and re-cuts the sheet for each", async ({ page }) => {
        // The parts sheet is open on arrival — half of what this tool makes.
        const panel = page.getByTestId("bottom-panel");
        await expect(panel).toBeVisible();
        await expect(panel.getByTestId("parts-preview").locator("svg")).toBeVisible();
        await expect(panel).toContainText("Handle layers ×7");

        const type = page.getByLabel("Type");
        await type.click();
        await page.getByRole("option", { name: "Knob" }).click();
        await expect(panel).toContainText("Knob layers");
        await expect(panel).toContainText("⌀ 22 mm down to ⌀ 12 mm");

        await type.click();
        await page.getByRole("option", { name: "Arch" }).click();
        await expect(panel).toContainText("Uprights ×2");
        await expect(panel).toContainText("Grip bar ×1");
    });

    test("lets the handle's own dimensions be set", async ({ page }) => {
        const panel = page.getByTestId("bottom-panel");
        // Seven layers of 3 mm ply, ⌀ 15 mm, until told otherwise.
        await expect(panel).toContainText("Handle layers ×7");
        await expect(panel).toContainText("⌀ 15 mm");

        const layers = page.getByLabel("Layers, exact value");
        await layers.fill("4");
        await layers.blur();
        await expect(panel).toContainText("Handle layers ×4");
        await expect(panel).toContainText("12 mm of grip");

        const size = page.getByLabel("Diameter, exact value");
        await size.fill("30");
        await size.blur();
        await expect(panel).toContainText("⌀ 30 mm");
    });

    test("gives the arch an upright height the sheet does not bound", async ({ page }) => {
        await page.getByLabel("Type").click();
        await page.getByRole("option", { name: "Arch" }).click();

        const panel = page.getByTestId("bottom-panel");
        await expect(panel).toContainText("14 mm × 25 mm");

        const h = page.getByLabel("Upright height, exact value");
        await h.fill("45");
        await h.blur();
        await expect(panel).toContainText("14 mm × 45 mm");
        await expect(panel).toContainText("48 mm of clearance");
    });

    test("cuts no cap, whichever handle is picked", async ({ page }) => {
        const panel = page.getByTestId("bottom-panel");
        for (const h of ["Discs", "Knob", "Bar", "Arch"]) {
            await page.getByLabel("Type").click();
            await page.getByRole("option", { name: h, exact: true }).click();
            await expect(panel).not.toContainText(/cap/i);
        }
    });

    test("drops the parts sheet entirely when no handle is wanted", async ({ page }) => {
        await page.getByLabel("Type").click();
        await page.getByRole("option", { name: "None" }).click();

        await expect(page.getByTestId("export-extra-parts")).toHaveCount(0);
        await expect(page.getByTestId("statusbar")).not.toContainText("Handle & parts");
        await expect(page.getByTestId("bottom-panel")).toHaveCount(0);
    });

    test("asks for a real size when the SVG did not state one", async ({ page }) => {
        await openFile(page, svgNoSize());
        await waitForDrawing(page);

        // Only meaningful while the design decides the plate — with a named size
        // the source's own scale is irrelevant.
        await page.getByRole("switch", { name: "Set the size" }).click();

        const width = page.getByLabel("Design width in millimetres");
        await expect(width).toBeVisible();
        await width.fill("100");
        await width.blur();
        // The geometry is scaled so the design itself is 100 mm wide, plus the
        // 3 mm margin on each side.
        await expect(stat(page, "Size")).toContainText("106.0 mm");
    });
});

test.describe("outer contour tracer", () => {
    test.beforeEach(async ({ page }) => {
        await openTool(page, "contour");
        await openFile(page, svgTwoItems());
        await waitForDrawing(page);
    });

    test("traces each item separately until they are joined", async ({ page }) => {
        await expect(stat(page, "Cut lines")).toContainText("2");
        await expect(stat(page, "Accuracy")).toContainText("exact contour");
    });

    test("offers picking only when there is more than one item", async ({ page }) => {
        await expect(page.getByRole("radio", { name: /Pick items/ })).toBeVisible();

        await openFile(page, svgOneItem());
        await waitForDrawing(page);
        await expect(page.getByRole("radio", { name: /Pick items/ })).toHaveCount(0);
    });

    test("picks an item by clicking it on the canvas", async ({ page }) => {
        await page.getByRole("radio", { name: /Pick items/ }).click();
        const inspector = page.getByTestId("inspector");
        await expect(inspector).toContainText("0");

        await page.getByRole("button", { name: "Select all" }).click();
        await expect(stat(page, "Cut lines")).toContainText("2");

        await page.getByRole("button", { name: "Clear" }).click();
        await expect(inspector.getByText("/ 2")).toBeVisible();
    });

    test("joins the items into one plate", async ({ page }) => {
        await page.getByRole("switch", { name: "Join into one plate" }).click();
        await expect(page.getByLabel("Join by")).toBeVisible();
        await expect(stat(page, "Cut lines")).toContainText("1");
    });

    test("joins them with a taut band too", async ({ page }) => {
        await page.getByRole("switch", { name: "Join into one plate" }).click();
        await page.getByLabel("Join by").click();
        await page.getByRole("option", { name: "Taut band" }).click();
        await expect(stat(page, "Cut lines")).toContainText("1");
        // The hull is exact geometry — no grid, so no tolerance to report.
        await expect(stat(page, "Accuracy")).toContainText("exact contour");
    });

    test("grows the plate with the border, and says what it cost", async ({ page }) => {
        const border = page.getByLabel("Border, exact value");
        await border.fill("5");
        await border.blur();
        await expect(stat(page, "Cut size")).toContainText("65.0 mm × 30.0 mm");
        // An offset is resolved on a fine grid, so it reports a tolerance.
        await expect(stat(page, "Accuracy")).toContainText("±");
    });

    test("applies a preset from the sidebar and lets it be undone", async ({ page }) => {
        await page.getByRole("button", { name: /Backing plate/ }).click();
        await expect(page.getByLabel("Border, exact value")).toHaveValue("3");
        await page.getByRole("button", { name: "Undo" }).click();
        await expect(page.getByLabel("Border, exact value")).toHaveValue("0");
    });

    test("exports the cut line, and the cut line over the design", async ({ page }) => {
        const one = await exportDefault(page);
        expect(one.suggestedFilename()).toBe("pair_outline.svg");

        const two = await exportExtra(page, "outline-design");
        expect(two.suggestedFilename()).toBe("pair_outline_with_design.svg");
    });

    test("hands the cut line on to the stamp creator from the toolbar", async ({ page }) => {
        await page.getByTestId("send-to").click();
        await page.getByRole("menuitem", { name: /Stamp/ }).click();

        await expect(page).toHaveURL(/\/stamp\/$/);
        await waitForDrawing(page);
        await expect(page.getByTestId("sidebar")).toContainText("pair_outline");
        await expect(page.getByTestId("sidebar")).toContainText("from Outer contour");
    });
});

test.describe("image tracer", () => {
    test.beforeEach(async ({ page }) => {
        await openTool(page, "trace");
        await openFile(page, pngDisc());
        await waitForDrawing(page);
    });

    test("turns a bitmap into vector paths", async ({ page }) => {
        await expect(stat(page, "Paths")).toContainText("1");
        await expect(stat(page, "Nodes")).not.toContainText("0 ");
        await expect(stat(page, "Source")).toContainText("120×120 px");
    });

    test("moves the threshold and re-traces", async ({ page }) => {
        const before = await stat(page, "Nodes").innerText();
        const t = page.getByLabel("Brightness threshold, exact value");
        await t.fill("250");
        await t.blur();
        await expect(stat(page, "Nodes")).not.toHaveText(before);
    });

    test("renames the threshold when judging by transparency", async ({ page }) => {
        await page.getByRole("switch", { name: "Judge by transparency" }).click();
        await expect(page.getByRole("slider", { name: "Opacity threshold" })).toBeVisible();
    });

    test("swaps the cleanup control for the centreline's own", async ({ page }) => {
        await expect(page.getByRole("slider", { name: "Ignore smaller than" })).toBeVisible();
        await page.getByRole("radio", { name: "Centreline" }).click();
        await expect(page.getByRole("slider", { name: "Shortest branch" })).toBeVisible();
        await expect(page.getByRole("slider", { name: "Ignore smaller than" })).toHaveCount(0);
    });

    test("traces a stroke down its middle", async ({ page }) => {
        await openFile(page, pngStrokes());
        await waitForDrawing(page);
        await page.getByRole("radio", { name: "Centreline" }).click();
        await expect(stat(page, "Lines")).toBeVisible();
    });

    test("keeps the preview aids out of the settings", async ({ page }) => {
        // Fading the source and showing nodes never touch the export, so they
        // are view toggles on the stage — not properties in the inspector.
        await expect(page.getByRole("button", { name: "Show every path node" })).toBeVisible();
        await expect(page.getByTestId("inspector").getByText("Show points")).toHaveCount(0);

        await page.getByRole("button", { name: "Show every path node" }).click();
        await expect(page.getByTestId("stage-canvas").locator("circle").first()).toBeVisible();
    });

    test("scales the result to a width you name", async ({ page }) => {
        const width = page.getByLabel("Traced width in millimetres");
        await width.fill("100");
        await width.blur();
        await expect(stat(page, "Size")).toContainText("100.0 ×");
    });

    test("switches the operation between engraving and cutting", async ({ page }) => {
        await expect(page.locator("li", { hasText: "Surface engraving" })).toBeVisible();
        await page.getByRole("radio", { name: "Cut" }).click();
        await expect(page.locator("li", { hasText: "cutting" })).toBeVisible();
    });

    test("exports the traced vectors", async ({ page }) => {
        const dl = await exportDefault(page);
        expect(dl.suggestedFilename()).toBe("disc_traced.svg");
    });

    test("applies a preset", async ({ page }) => {
        await page.getByRole("button", { name: /Line drawing/ }).click();
        await expect(page.getByRole("radio", { name: "Centreline" })).toHaveAttribute("data-state", "on");
    });
});

test.describe("xTool project converter", () => {
    test.beforeEach(async ({ page }) => {
        await openTool(page, "convert");
        await openFile(page, xcsProject());
        await waitForDrawing(page);
    });

    test("lists the project's canvases as pages of the document", async ({ page }) => {
        const sidebar = page.getByTestId("sidebar");
        await expect(sidebar.getByRole("tab")).toHaveCount(2);
        await expect(stat(page, "Canvases")).toContainText("2");

        await sidebar.getByRole("tab").nth(1).click();
        await expect(page.getByTestId("toolbar")).toContainText("Canvas 2");
    });

    test("keeps the operations apart and names them", async ({ page }) => {
        const inspector = page.getByTestId("inspector");
        await expect(inspector.locator("li", { hasText: "Line cutting" })).toBeVisible();
        await expect(inspector.locator("li", { hasText: "Line engraving" })).toBeVisible();
        await expect(stat(page, "Operations")).toContainText("2");
    });

    test("shows what the project says about the machine", async ({ page }) => {
        const sidebar = page.getByTestId("sidebar");
        await expect(sidebar).toContainText("xTool S1");
        await expect(sidebar).toContainText("3 mm");
    });

    test("exports each canvas, and all of them as a zip", async ({ page }) => {
        const dxf = await exportDefault(page);
        expect(dxf.suggestedFilename()).toBe("demo_Canvas_1.dxf");

        const svg = await exportAs(page, /^SVG/);
        expect(svg.suggestedFilename()).toBe("demo_Canvas_1.svg");

        const zip = await exportExtra(page, "zip");
        expect(zip.suggestedFilename()).toBe("demo.zip");
    });

    test("converts the laser parameters for another module", async ({ page }) => {
        await page.getByTestId("statusbar").getByRole("button", { name: /Laser parameters/ }).click();
        const panel = page.locator("section[aria-label='Laser parameters']");
        await expect(panel).toContainText("80 %");
        await expect(panel).toContainText("300 mm/s");

        await panel.getByLabel("Laser to convert the settings for").click();
        await page.getByRole("option", { name: "Diode 20 W" }).click();
        // 10 W at 80 % is 8 W; a 20 W module needs 40 % for the same energy.
        await expect(panel).toContainText("40 % · 300 mm/s");
    });

    test("warns about a wavelength change rather than converting it quietly", async ({ page }) => {
        await page.getByTestId("statusbar").getByRole("button", { name: /Laser parameters/ }).click();
        const panel = page.locator("section[aria-label='Laser parameters']");
        await panel.getByLabel("Laser to convert the settings for").click();
        await page.getByRole("option", { name: /CO₂ 40 W/ }).click();
        await expect(panel).toContainText("455 nm → 10600 nm");
    });
});
