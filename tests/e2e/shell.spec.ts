import { expect, test } from "@playwright/test";
import { svgOneItem } from "./fixtures";
import { openFile, openTool, waitForDrawing } from "./helpers";

// The shell is the redesign. These are the promises it makes on every tool
// page, so they are tested once here rather than four times over.

test.describe("workspace shell", () => {
    test("gives the canvas the majority of the screen", async ({ page }) => {
        // The contour tracer, because the stamp opens its parts sheet in a panel
        // under the stage — deliberately, and measured separately below.
        await openTool(page, "contour");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        const stage = (await page.locator("section[aria-label='Canvas']").boundingBox())!,
            shell = (await page.getByTestId("workspace").boundingBox())!;

        // Both panels docked at 1920: 224 + 272 px of chrome leaves the stage
        // ~74 % of the width it competes for. That is the number the brief is
        // about — the toolbar and the status bar are 76 px of vertical chrome
        // nobody was ever going to give the drawing.
        expect(stage.width / shell.width).toBeGreaterThan(0.7);
        expect(stage.height / shell.height).toBeGreaterThan(0.9);
    });

    // A tool page is the workspace first and the prose second. Anything left in
    // the default slot above the island pushes the whole app down the page and
    // renders above the toolbar, which is exactly how a stray row of operation
    // chips once ended up sitting on top of the converter.
    for (const slug of ["convert", "contour", "trace", "stamp"]) {
        test(`opens ${slug} with the workspace filling the first screen`, async ({ page }) => {
            await openTool(page, slug);
            const box = (await page.getByTestId("workspace").boundingBox())!;
            expect(box.y).toBe(0);
            expect(box.height).toBe(page.viewportSize()!.height);
            // The toolbar is the topmost thing in it, and it is 48 px tall.
            const toolbar = (await page.getByTestId("toolbar").boundingBox())!;
            expect(toolbar.y).toBe(0);
        });
    }

    test("keeps every output in the toolbar, and nowhere else", async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        const toolbar = page.getByTestId("toolbar");
        // One Export, the tool's own companion file beside it, and Send to.
        await expect(toolbar.getByTestId("export-button")).toHaveCount(1);
        await expect(toolbar.getByTestId("export-extra-parts")).toBeVisible();
        await expect(toolbar.getByTestId("send-to")).toBeVisible();

        // Nothing that writes or forwards a file has been left in a panel.
        await expect(page.getByTestId("sidebar").getByTestId("send-to")).toHaveCount(0);
        for (const panel of ["sidebar", "inspector", "statusbar"]) {
            const texts = await page.getByTestId(panel).getByRole("button").allInnerTexts();
            expect(texts.filter(s => /download|export|send to/i.test(s))).toHaveLength(0);
        }
    });

    test("keeps global actions in the toolbar and properties in the inspector", async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        const toolbar = page.getByTestId("toolbar");
        await expect(toolbar.getByRole("button", { name: "Open" })).toBeVisible();
        await expect(toolbar.getByRole("button", { name: "Undo" })).toBeVisible();
        // No geometry control has leaked upwards.
        await expect(toolbar.getByLabel("Margin", { exact: false })).toHaveCount(0);

        const inspector = page.getByTestId("inspector");
        await expect(inspector.getByRole("slider", { name: "Margin" })).toBeVisible();
        // …and no global one has leaked downwards.
        await expect(inspector.getByTestId("export-button")).toHaveCount(0);
    });

    test("starts empty and says so in both panels", async ({ page }) => {
        await openTool(page, "contour");
        await expect(page.getByTestId("empty-drop")).toBeVisible();
        await expect(page.getByTestId("inspector")).toContainText("Nothing on the canvas yet");
        await expect(page.getByTestId("sidebar")).toContainText("Nothing open");
        await expect(page.getByTestId("export-button")).toBeDisabled();
    });

    test("undoes a property change from the keyboard", async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        const margin = page.getByLabel("Margin, exact value");
        await expect(margin).toHaveValue("3");

        await margin.fill("12");
        await margin.blur();
        await expect(margin).toHaveValue("12");

        // Focus must be off the field, or Ctrl+Z is the field's own undo.
        await page.getByTestId("stage-canvas").click({ position: { x: 20, y: 20 } });
        await page.keyboard.press("Control+z");
        await expect(margin).toHaveValue("3");

        await page.keyboard.press("Control+Shift+z");
        await expect(margin).toHaveValue("12");
    });

    test("lists every change in the sidebar and jumps back to one", async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        const sidebar = page.getByTestId("sidebar");
        await sidebar.getByRole("button", { name: /History/ }).click();

        await page.getByRole("radio", { name: "Circle" }).click();
        await expect(sidebar.getByRole("button", { name: "Plate shape" })).toBeVisible();

        await sidebar.getByRole("button", { name: "Opened" }).click();
        await expect(page.getByRole("radio", { name: "Rect" })).toHaveAttribute("data-state", "on");
    });

    test("remembers which panels were open", async ({ page }) => {
        await openTool(page, "contour");
        await expect(page.getByTestId("sidebar")).toBeVisible();

        await page.getByRole("button", { name: "Toggle project panel" }).click();
        await expect(page.getByTestId("sidebar")).toBeHidden();

        await page.reload();
        await expect(page.getByTestId("workspace")).toBeVisible();
        await expect(page.getByTestId("sidebar")).toBeHidden();
    });

    test("keeps a workshop setting between visits but not a per-file one", async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        // The stock on the bench, and the width the stamps get cut at: facts
        // about this workshop.
        await page.getByLabel("Material thickness in millimetres").fill("5");
        await page.getByLabel("Material thickness in millimetres").blur();
        await page.getByLabel("Width", { exact: true }).fill("70");
        await page.getByLabel("Width", { exact: true }).blur();

        await page.reload();
        await expect(page.getByTestId("workspace")).toBeVisible();
        // The file does not come back — the workspace opens on its drop zone.
        await expect(page.getByTestId("sidebar")).toContainText("Nothing open");

        await openFile(page, svgOneItem());
        await waitForDrawing(page);
        await expect(page.getByLabel("Material thickness in millimetres")).toHaveValue("5");
        await expect(page.getByLabel("Width", { exact: true })).toHaveValue("70");
    });

    test("starts every contour at an exact 0 mm border", async ({ page }) => {
        await openTool(page, "contour");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);
        await expect(page.getByLabel("Border, exact value")).toHaveValue("0");

        await page.getByLabel("Border, exact value").fill("7");
        await page.getByLabel("Border, exact value").blur();

        // A border belongs to the job in front of you, not to the bench: the
        // next design starts from its own contour again.
        await page.reload();
        await expect(page.getByTestId("workspace")).toBeVisible();
        await openFile(page, svgOneItem());
        await waitForDrawing(page);
        await expect(page.getByLabel("Border, exact value")).toHaveValue("0");
    });

    test("keeps the grid on the drawing after the stage is reshaped", async ({ page }) => {
        await openTool(page, "contour");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        // Reshape the stage the way opening a panel or resizing the window does,
        // then zoom in — the two things that used to break the mapping together.
        await page.getByRole("button", { name: "Toggle project panel" }).click();
        await page.setViewportSize({ width: 1500, height: 800 });
        await page.waitForTimeout(250);
        for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
        await page.waitForTimeout(150);

        const read = () => page.evaluate(() => {
            const el = document.querySelector("[data-testid='stage-canvas']") as HTMLElement,
                vb = el.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
            return { vb, cw: el.clientWidth, ch: el.clientHeight, gx: parseFloat(el.style.getPropertyValue("--grid-x")) };
        });

        const a = await read();
        // Left at the old aspect ratio, preserveAspectRatio="meet" letterboxes
        // the drawing and everything that trusts clientWidth / viewBox.width —
        // grid, rulers, cursor readout — runs ahead of it.
        expect(a.vb[2]! / a.vb[3]!).toBeCloseTo(a.cw / a.ch, 3);

        const box = (await page.getByTestId("stage-canvas").boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);

        const b = await read();
        const pxPerMm = a.cw / a.vb[2]!,
            drawingMoved = (b.vb[0]! - a.vb[0]!) * pxPerMm,
            gridMoved = -(b.gx - a.gx);
        expect(drawingMoved).toBeCloseTo(200, 0);
        expect(gridMoved).toBeCloseTo(drawingMoved, 0);
    });

    test("keeps the grid pinned to the drawing while it is dragged", async ({ page }) => {
        await openTool(page, "contour");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        const canvas = page.getByTestId("stage-canvas");
        const gridVars = () => canvas.evaluate(el => ({
            x: el.style.getPropertyValue("--grid-x"),
            y: el.style.getPropertyValue("--grid-y"),
            minor: el.style.getPropertyValue("--grid-minor")
        }));

        const before = await gridVars();
        // A square has to be a round number of millimetres at any zoom, so the
        // spacing is computed rather than fixed.
        expect(before.minor).not.toBe("");

        const box = (await canvas.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 - 90, { steps: 8 });
        await page.mouse.up();

        const after = await gridVars();
        // The grid is painted in screen pixels, so its origin has to be re-derived
        // every frame or it sits still under a drawing that is moving.
        expect(after.x).not.toBe(before.x);
        expect(after.y).not.toBe(before.y);
        expect(after.minor).toBe(before.minor); // …but the spacing only follows zoom
    });

    test("draws both rulers across the whole stage, with readable numbers", async ({ page }) => {
        await openTool(page, "contour");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);
        await expect(page.locator("canvas")).toHaveCount(2);

        const stage = (await page.locator("section[aria-label='Canvas']").boundingBox())!;
        const rulers = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("canvas")).map(c => {
                const el = c as HTMLCanvasElement,
                    d = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
                // The label grey is #878da0; the background is #0e1016.
                let text = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i]! > 100) text++;
                return { w: el.clientWidth, h: el.clientHeight, text };
            });
        });

        // A canvas is a replaced element: `left` + `right` with no width leaves it
        // at its intrinsic 2:1 ratio, which once collapsed both rulers to 40 px.
        const [top, left] = rulers;
        expect(top!.w).toBeGreaterThan(stage.width - 40);
        expect(left!.h).toBeGreaterThan(stage.height - 40);
        // …and the numbers are actually inside the strip. The vertical ruler's
        // labels are rotated −90°, which put four fifths of every glyph off the
        // left edge of a 20 px strip.
        //
        // Measured against the horizontal ruler rather than against a pixel
        // count, because the two share a font: clipped, the left ruler drew
        // 15 % of the top one's ink; whole, it draws about 35 %. Anything a
        // different platform's font rendering does to one, it does to both.
        expect(top!.text).toBeGreaterThan(20);
        expect(left!.text).toBeGreaterThan(top!.text * 0.25);
    });

    test("shows a grid and a live zoom readout", async ({ page }) => {
        await openTool(page, "contour");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        await expect(page.getByTestId("statusbar")).toContainText("100 %");

        await page.getByRole("button", { name: "Zoom in", exact: true }).click();
        await expect(page.getByTestId("statusbar")).toContainText("140 %");

        await page.getByRole("button", { name: "Fit", exact: true }).click();
        await expect(page.getByTestId("statusbar")).toContainText("100 %");

        await page.getByRole("button", { name: "Rulers" }).click();
        await expect(page.locator("canvas")).toHaveCount(0);
    });

    test("stays fitted when a panel opens under the stage", async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);
        // The parts sheet takes 320 px off the stage's height as it arrives; the
        // drawing has to still be the whole drawing afterwards.
        await expect(page.getByTestId("bottom-panel")).toBeVisible();
        await expect(page.getByTestId("statusbar")).toContainText("100 %");
    });

    test("switches tool from the toolbar", async ({ page }) => {
        await openTool(page, "stamp");
        await page.getByTestId("tool-switcher").click();
        await page.getByRole("menuitem", { name: /Trace/ }).click();
        await expect(page).toHaveURL(/\/trace\/$/);
        await expect(page.getByTestId("tool-switcher")).toContainText("Trace");
    });

    test("never scrolls the page itself", async ({ page }) => {
        await openTool(page, "contour");
        await openFile(page, svgOneItem());
        await waitForDrawing(page);

        const doc = await page.evaluate(() => ({
            scrollH: document.documentElement.scrollHeight,
            clientH: document.documentElement.clientHeight,
            clientW: document.documentElement.clientWidth,
            innerW: window.innerWidth
        }));
        // Nothing below the fold to scroll to, and therefore no page scrollbar
        // taking a stripe off the drawing.
        expect(doc.scrollH).toBe(doc.clientH);
        expect(doc.clientW).toBe(doc.innerW);
    });

    test("opens the explainer as an overlay from the left panel", async ({ page }) => {
        await openTool(page, "contour");

        const dialog = page.locator("#tool-about");
        await expect(dialog).toBeHidden();

        await page.getByTestId("about-button").click();
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("h1")).toHaveText("Outer contour tracer");

        // Centred, not pinned to a corner: Tailwind's preflight zeroes the
        // margin a modal <dialog> centres itself with.
        const box = (await dialog.boundingBox())!,
            vp = page.viewportSize()!;
        expect(Math.abs((box.x + box.width / 2) - vp.width / 2)).toBeLessThan(2);
        expect(Math.abs((box.y + box.height / 2) - vp.height / 2)).toBeLessThan(2);
        await expect(dialog).toContainText("runs entirely in your browser");
        // The explainer cards come with it, not just the heading.
        await expect(dialog).toContainText("Items, not shapes");
        // The left panel is the only door into it.
        await expect(page.getByTestId("statusbar")).not.toContainText("How this works");

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
    });

    test("closes the explainer on the backdrop and on its own button", async ({ page }) => {
        await openTool(page, "trace");
        const dialog = page.locator("#tool-about");

        await page.getByTestId("about-button").click();
        await expect(dialog).toBeVisible();
        await page.getByRole("button", { name: "Close" }).click();
        await expect(dialog).toBeHidden();

        await page.getByTestId("about-button").click();
        await expect(dialog).toBeVisible();
        // A click on the backdrop lands on the dialog element itself.
        await page.mouse.click(8, 8);
        await expect(dialog).toBeHidden();
    });

    test("keeps the explainer copy in the page's HTML for crawlers", async ({ request }) => {
        const html = await (await request.get("/LaserKit/contour/")).text();
        // Server-rendered, not fetched on open: this copy is what a lot of the
        // search traffic arrives for.
        expect(html).toContain("Outer contour tracer");
        expect(html).toContain("Items, not shapes");
        expect(html).toContain("Border 0 mm is exact");
    });

    test("reports a file it cannot read without losing the workspace", async ({ page }) => {
        await openTool(page, "stamp");
        await openFile(page, { name: "broken.svg", mimeType: "image/svg+xml", buffer: Buffer.from("nope") });
        await expect(page.getByRole("alert")).toContainText(/could not be read|not a readable SVG/i);
        await expect(page.getByTestId("workspace")).toBeVisible();
    });
});
