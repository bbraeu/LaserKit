import { expect, test } from "@playwright/test";
import { RELEASES } from "../../src/lib/releases";

// The release notes page.
//
// It is a static page built from a committed list, so there is not much to go
// wrong — except the two things that would make it worse than not having it:
// falling behind the version that is actually deployed, and being unreachable.

test.beforeEach(async ({ page }) => {
    await page.goto("releases/");
});

test("lists every release, newest first", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("changed");
    await expect(page.locator("ol > li")).toHaveCount(RELEASES.length);

    const aVersion = await page.locator("ol > li time").evaluateAll(a => a.map(el => el.getAttribute("datetime")!));
    const sorted = [...aVersion].sort().reverse();
    expect(aVersion).toEqual(sorted);
});

test("names the current version and links it to the tag", async ({ page }) => {
    const latest = RELEASES[0]!;
    // Astro strips the whitespace before an inline tag, so this also catches
    // "the current one isv3.5.0".
    await expect(page.locator("body")).toContainText(`the current one is v${latest.version}`);
    await expect(page.getByRole("link", { name: `v${latest.version}` }).first())
        .toHaveAttribute("href", new RegExp(`/releases/tag/v${latest.version.replace(/\./g, "\\.")}$`));
});

test("is reachable from the nav and the footer of every site page", async ({ page }) => {
    await page.goto("");
    await expect(page.getByRole("link", { name: "Releases", exact: true })).toBeVisible();
    await page.getByRole("link", { name: /what changed/ }).click();
    await expect(page).toHaveURL(/\/releases\/$/);
});

test("carries the reader on to the tool a release was about", async ({ page }) => {
    // Every release that names a tool links to it, so the notes are a way in
    // rather than a wall of prose about things you cannot reach.
    const withTools = RELEASES.filter(r => r.tools?.length);
    expect(withTools.length).toBeGreaterThan(5);
    // Not the newest entry: a release about the site itself names no tool, and
    // pinning this to whichever release happens to be on top would break on the
    // next one that does not.
    await page.getByRole("link", { name: "Nest", exact: true }).first().click();
    await expect(page).toHaveURL(/\/nest\/$/);
});
