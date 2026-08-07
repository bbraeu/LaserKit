import { expect } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import type { Fixture } from "./fixtures";

/** Open a tool and wait for its workspace to hydrate. */
export const openTool = async (page: Page, slug: string): Promise<void> => {
    await page.goto(slug.endsWith("/") ? slug : `${slug}/`);
    await expect(page.getByTestId("workspace")).toBeVisible();
};

/** Drop a file on the workspace the way the toolbar's Open does. */
export const openFile = async (page: Page, fixture: Fixture): Promise<void> => {
    await page.getByTestId("stage-file-input").setInputFiles(fixture);
};

/** Wait for the stage to hold an actual drawing rather than an empty state. */
export const waitForDrawing = async (page: Page): Promise<void> => {
    await expect(page.getByTestId("stage-canvas").locator("svg")).toBeVisible();
};

/** The value of one status-bar field, e.g. "Size". */
export const stat = (page: Page, label: string) =>
    page.getByTestId("statusbar").locator("li", { hasText: new RegExp(`^${label}`) });

/** Click Export and hand back the download it produced. */
export const exportDefault = async (page: Page): Promise<Download> => {
    const wait = page.waitForEvent("download");
    await page.getByTestId("export-button").click();
    return wait;
};

/** Pick a format out of the export menu and hand back its download. */
export const exportAs = async (page: Page, label: string | RegExp): Promise<Download> => {
    await page.getByTestId("export-menu").click();
    // The row has to be there before it is clicked: two exports in a row race
    // the menu's own open animation otherwise.
    const item = page.getByRole("menuitem", { name: label });
    await expect(item).toBeVisible();
    const wait = page.waitForEvent("download");
    await item.click();
    return wait;
};

/** Click one of the tool's companion download buttons in the toolbar. */
export const exportExtra = async (page: Page, id: string): Promise<Download> => {
    const wait = page.waitForEvent("download");
    await page.getByTestId(`export-extra-${id}`).click();
    return wait;
};

/** Set a slider-backed property by typing into its number box. */
export const setNumber = async (page: Page, label: string, value: number): Promise<void> => {
    const field = page.getByLabel(`${label}, exact value`);
    await field.fill(String(value));
    await field.blur();
};
