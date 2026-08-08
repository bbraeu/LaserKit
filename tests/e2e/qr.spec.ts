import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat, waitForDrawing } from "./helpers";

// The QR tool in a real browser. The encoding is a library's and the geometry
// is pinned in tests/unit/qr.test.ts; what is left for here is the wiring, and
// the one figure the tool exists to put in front of you before you cut.

const panel = (page: Page) => page.getByTestId("inspector");

const setNum = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByRole("spinbutton", { name: `${label}, exact value`, exact: true });
    await field.fill(String(value));
    await field.blur();
};

const setText = async (page: Page, s: string): Promise<void> => {
    const box = page.getByLabel("Content", { exact: true });
    await box.fill(s);
    await box.blur();
};

test.beforeEach(async ({ page }) => {
    await openTool(page, "qr");
    await waitForDrawing(page);
});

test("draws a code for the link it opens with", async ({ page }) => {
    await expect(stat(page, "Version")).toContainText("3");
    await expect(stat(page, "Modules")).toContainText("29 × 29");
    await expect(stat(page, "Plate")).toContainText("50 × 50 mm");
});

test("grows the code as the content grows", async ({ page }) => {
    await setText(page, "hi");
    await expect(stat(page, "Version")).toContainText("1");
    await setText(page, "x".repeat(200));
    await expect(stat(page, "Modules")).not.toContainText("21 × 21");
});

test("puts the module size in front of you, and warns when it is too small", async ({ page }) => {
    await expect(stat(page, "One module")).toContainText("mm");
    await setText(page, "x".repeat(300));
    await setNum(page, "Plate", 20);
    await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("stops scanning");
});


test("costs modules for more error correction", async ({ page }) => {
    await setText(page, "x".repeat(100));
    const at = async () => (await stat(page, "Version").innerText()).replace(/\D/g, "");
    const low = await (async () => { await panel(page).getByRole("radio", { name: /^L/ }).click(); return at(); })();
    await panel(page).getByRole("radio", { name: /^H/ }).click();
    await expect.poll(at).not.toBe(low);
});

test("refuses more than a code can hold, rather than drawing a lie", async ({ page }) => {
    await panel(page).getByRole("radio", { name: /^H/ }).click();
    await setText(page, "x".repeat(2000));
    // A build that throws is an alert over the stage, not a note in the status
    // bar: there is no drawing to annotate.
    await expect(page.getByRole("alert")).toContainText("too much data");
});

test("offers inlay as the only way to cut one, and says how many pieces", async ({ page }) => {
    await panel(page).getByRole("button", { name: "Cutting", exact: true }).click();
    await panel(page).getByRole("combobox", { name: "The dark squares" }).click();
    await page.getByRole("option", { name: /Cut for inlay/ }).click();
    await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText(/dark pieces come off the bed loose/);
});

test("writes the code in all three formats, named after the link", async ({ page }) => {
    await setText(page, "https://example.com/hello");
    const svg = await exportDefault(page);
    expect(svg.suggestedFilename()).toBe("qr_example_com_hello.svg");
    for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
        const dl = await exportAs(page, new RegExp(`^${label}`));
        expect(dl.suggestedFilename()).toBe(`qr_example_com_hello.${ext}`);
    }
});
