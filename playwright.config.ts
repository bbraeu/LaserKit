import { defineConfig, devices } from "@playwright/test";

// End-to-end against the real build, in a real Chromium.
//
// This is not belt-and-braces on top of the unit tests — it is the only place a
// lot of this app *can* be tested. Every tool's geometry goes through the
// browser's own getCTM, getBBox and DOMParser, the stage's rulers are drawn on a
// canvas from a live layout, and an export is a download. jsdom has none of
// that, so a "unit test" of the conversion path would be a test of a mock.
//
// It runs against `astro preview`, not the dev server: the artifact that gets
// deployed is the one worth testing, and the dev server's dependency cache has
// a habit of going stale after a dependency changes.
export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
    timeout: 45_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL: "http://localhost:4321/LaserKit/",
        trace: "on-first-retry",
        // A design app is a desktop app; the panels only dock at 1280 and up.
        viewport: { width: 1920, height: 1080 }
    },

    projects: [
        // The viewport is set above deliberately, *after* the device preset —
        // spreading the preset here would silently put it back to 1280 × 720.
        { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } }
    ],

    webServer: {
        command: "pnpm run build && pnpm run preview",
        url: "http://localhost:4321/LaserKit/",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe"
    }
});
