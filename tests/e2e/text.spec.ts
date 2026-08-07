import { expect, test } from "@playwright/test";
import { exportAs, exportDefault, openTool, stat } from "./helpers";

// The text generator has no file to open — the document is the text — so these
// start from what it opens with rather than from a fixture.

/** The stage holds a drawing built from the current settings. */
const settled = async (page: import("@playwright/test").Page) => {
    await expect(page.getByTestId("stage-canvas").locator("svg")).toBeVisible();
    await expect(stat(page, "Size")).toContainText("mm");
};

/** The colour legend on the stage, which is the only place a colour is named. */
const legend = (page: import("@playwright/test").Page) =>
    page.getByLabel("Colours in this drawing");

const setText = async (page: import("@playwright/test").Page, s: string) => {
    const box = page.getByLabel("Text", { exact: true });
    await box.fill(s);
    await box.blur();
};

/** "Size116.3 mm × 25.2 mm" → [116.3, 25.2] */
const size = async (page: import("@playwright/test").Page): Promise<[number, number]> => {
    const s = (await stat(page, "Size").innerText()).replace("Size", "");
    const [w, h] = s.split("×").map(x => parseFloat(x));
    return [w!, h!];
};

// Reading the size *once* after changing a setting races the debounced rebuild
// and samples the shape that was there a frame earlier. Every assertion about a
// dimension therefore polls until the geometry has caught up.
const pollWidth = (page: import("@playwright/test").Page) => expect.poll(async () => (await size(page))[0]);

/**
 * A status-bar figure, once it has stopped moving.
 *
 * Anything used as a *baseline* has to be read after the build that produced it
 * finished, or the comparison is against a frame of some earlier state. Polling
 * until two consecutive reads agree says that without guessing a sleep.
 */
const settledStat = async (page: import("@playwright/test").Page, label: string): Promise<string> => {
    let last = "";
    await expect.poll(async () => {
        const now = await stat(page, label).innerText(),
            same = now === last && now.length > label.length;
        last = now;
        return same;
    }).toBe(true);
    return last;
};
const pollHeight = (page: import("@playwright/test").Page) => expect.poll(async () => (await size(page))[1]);

test.describe("text generator", () => {
    test.beforeEach(async ({ page }) => {
        await openTool(page, "text");
        await settled(page);
    });

    test("opens on a keychain: one welded plate, engraved letters, a hole", async ({ page }) => {
        await expect(page.getByLabel("Text", { exact: true })).toHaveValue("LaserKit");
        // The plate and the hole; the letters are engraved, not cut.
        await expect(stat(page, "Cut lines")).toContainText("2");
        await expect(legend(page).getByText("engraved")).toBeVisible();
        await expect(page.getByRole("switch", { name: "Keyring hole" })).toBeChecked();
    });

    test("sets the text that was typed", async ({ page }) => {
        const [w0] = await size(page);
        await setText(page, "ANNA");
        await expect(stat(page, "Size")).not.toContainText(`${w0.toFixed(1)} mm ×`);
        const [w1] = await size(page);
        // A shorter word is a shorter piece.
        expect(w1).toBeLessThan(w0);
    });

    test("cap height is millimetres of capital, not font size", async ({ page }) => {
        await setText(page, "H");
        const height = page.getByLabel("Cap height, exact value");
        await height.fill("40");
        await height.blur();
        // An H is exactly the cap height, plus the border on each side.
        await pollHeight(page).toBeGreaterThan(40);
        await pollHeight(page).toBeLessThan(40 + 2 * 2.5 + 1.5);
    });

    test("letter spacing pushes the letters apart", async ({ page }) => {
        const [w0] = await size(page);
        const sp = page.getByLabel("Letters, exact value");
        await sp.fill("6");
        await sp.blur();
        // Seven gaps × 6 mm, less whatever the weld takes back.
        await pollWidth(page).toBeGreaterThan(w0 + 20);
    });

    test("the plate can be turned off, leaving only the lettering", async ({ page }) => {
        await page.getByRole("switch", { name: "Backing plate" }).click();
        await expect(legend(page).getByText("plate")).toHaveCount(0);
        await expect(page.getByRole("slider", { name: "Border" })).toHaveCount(0);
    });

    test("joins the letters into one piece, or leaves them loose", async ({ page }) => {
        // At the default 2.5 mm border the letters already weld into each other,
        // so drop it to nothing first — that is the case joining is *for*.
        const border = page.getByLabel("Border, exact value");
        await border.fill("0");
        await border.blur();
        await expect(stat(page, "Cut lines")).toContainText("2"); // one plate + the hole

        await page.getByRole("switch", { name: "Join the letters" }).click();
        // Unjoined and unborderd, every letter is its own cut line.
        await expect(stat(page, "Cut lines")).not.toHaveText("Cut lines2");
        await expect(page.getByTestId("statusbar")).toContainText(/notes?$|notes?[A-Z]/);
    });

    test("joins them with a taut band too", async ({ page }) => {
        await page.getByLabel("Join by").click();
        await page.getByRole("option", { name: "Taut band" }).click();
        await expect(stat(page, "Cut lines")).toContainText("2");
        // A hull around a word is much wider than the word's own outline.
        await pollWidth(page).toBeGreaterThan(100);
    });

    test("moves the keyring hole around the plate", async ({ page }) => {
        const [w0, h0] = await size(page);

        await page.getByRole("radio", { name: "Top" }).click();
        // The hole and its lug were on the left and are now on top: the piece
        // gets shorter across and taller down.
        await pollWidth(page).toBeLessThan(w0);
        await pollHeight(page).toBeGreaterThan(h0);
    });

    test("grows a lug so a hole off the end of the word has material to sit in", async ({ page }) => {
        const inset = page.getByLabel("Inset, exact value");
        await inset.fill("0");
        await inset.blur();
        // A wall of 2.5 mm means the plate follows the lug out rather than the
        // hole breaking through the edge — so no complaint about the hole.
        await expect(page.getByTestId("statusbar")).not.toContainText(/\d note/);
        await expect(stat(page, "Cut lines")).toContainText("2");
    });

    test("drags the keyring hole around the piece with the mouse", async ({ page }) => {
        await expect(page.getByRole("radio", { name: "Left", exact: true })).toHaveAttribute("data-state", "on");

        const grip = page.getByTestId("stage-handle");
        await expect(grip).toBeVisible();
        const g = (await grip.boundingBox())!,
            stage = (await page.getByTestId("stage-canvas").boundingBox())!;

        await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
        await page.mouse.down();
        // Level with the piece, not below it: "LaserKit" is 110 × 20 mm, so a
        // point three quarters down the stage is nearer its bottom edge than its
        // right one — and the nearest edge is exactly what the drag picks.
        await page.mouse.move(stage.x + stage.width * 0.88, stage.y + stage.height * 0.5, { steps: 10 });
        // Nothing is recomputed mid-drag: the grip moves, the geometry waits.
        await expect(page.getByRole("radio", { name: "Left", exact: true })).toHaveAttribute("data-state", "on");
        await page.mouse.up();

        // On release it comes back out as the same three numbers the sliders
        // set, so the canvas and the panel can never disagree.
        await expect(page.getByRole("radio", { name: "Right", exact: true })).toHaveAttribute("data-state", "on");
    });

    test("gives the ring its own tab when there is no backing plate", async ({ page }) => {
        await page.getByRole("switch", { name: "Backing plate" }).click();

        // A hole needs something to go through: the wall becomes the tab itself.
        const wall = page.getByLabel("Wall, exact value");
        await expect(wall).toBeEnabled();
        // It lands on the lettering, so there is nothing to complain about…
        await expect(page.getByTestId("statusbar")).not.toContainText(/\d note/);
        await expect(legend(page).getByText("cut line")).toBeVisible();

        // …and it is not cut all the way round, or the tab and the letter it
        // hangs off would both drop out of the sheet.
        await expect
            .poll(async () => parseInt((await stat(page, "Cut lines").innerText()).replace(/\D+/g, ""), 10))
            .toBeGreaterThan(1);

        await wall.fill("0");
        await wall.blur();
        await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
    });

    test("says so when the hole misses the plate", async ({ page }) => {
        const wall = page.getByLabel("Wall, exact value");
        await wall.fill("0");
        await wall.blur();
        const inset = page.getByLabel("Inset, exact value");
        await inset.fill("0");
        await inset.blur();

        await expect(page.getByTestId("statusbar")).toContainText(/\d note/);
        await page.getByTestId("statusbar").getByRole("button", { name: /notes?$/ }).hover();
        await expect(page.getByRole("tooltip")).toContainText("not fully on the plate");
    });

    test("engraves the seam where letters lap over each other", async ({ page }) => {
        await setText(page, "Wave");
        await settledStat(page, "Size");
        const [w0] = await size(page);

        // Tight enough that the letters genuinely run into each other — the
        // union then has no boundary between them left to read.
        const sp = page.getByLabel("Letters, exact value");
        await sp.fill("-8");
        await sp.blur();
        // Waited for against the width it *had*, not a number that would have to
        // be re-guessed whenever the runner's default sans changes.
        await pollWidth(page).toBeLessThan(w0 - 10);
        const before = await settledStat(page, "Points");

        await page.getByRole("switch", { name: "Engrave where letters overlap" }).click();
        // The legend only names the colour once there is really a seam on the
        // canvas, so its arrival *is* the assertion.
        await expect(legend(page).getByText("letter edges")).toBeVisible();
        await expect
            .poll(async () => parseInt((await stat(page, "Points").innerText()).replace(/\D+/g, ""), 10))
            .toBeGreaterThan(parseInt(before.replace(/\D+/g, ""), 10));
    });

    test("says so when the switch is on but nothing overlaps", async ({ page }) => {
        // Letters well apart: the switch is on, and honest about having nothing
        // to draw rather than claiming a colour that is not there.
        const [w0] = await size(page);
        const sp = page.getByLabel("Letters, exact value");
        await sp.fill("4");
        await sp.blur();
        // Toggled only once the wider spacing has been built. Clicking straight
        // away turns the seams on for the *old* spacing, where "LaserKit" does
        // have a pair of letters touching — which is what made this flaky.
        await pollWidth(page).toBeGreaterThan(w0 + 10);

        await page.getByRole("switch", { name: "Engrave where letters overlap" }).click();
        await expect(page.getByTestId("inspector")).toContainText("Nothing overlaps yet");
        await expect(legend(page).getByText("letter edges")).toHaveCount(0);
    });

    test("cuts the letters out for a stencil", async ({ page }) => {
        const cut = page.getByRole("radio", { name: "Cut", exact: true });
        await cut.click();
        await expect(cut).toHaveAttribute("data-state", "on");
        await expect(legend(page).getByText("engraved")).toHaveCount(0);
        // Plate, hole, and every letter contour.
        await expect
            .poll(async () => parseInt((await stat(page, "Cut lines").innerText()).replace(/\D+/g, ""), 10))
            .toBeGreaterThan(5);
    });

    test("lists the fonts this machine has, and sets the text in one", async ({ page }) => {
        await page.getByLabel("Font").click();
        const options = page.getByRole("option");
        await expect(options.first()).toBeVisible();
        // The three generics are always there; a CI runner adds whatever it has.
        expect(await options.count()).toBeGreaterThanOrEqual(3);

        const before = await stat(page, "Size").innerText();
        await page.getByRole("option", { name: "Mono (system)" }).click();
        // A different typeface is a different width — waited for, not sampled.
        await expect(stat(page, "Size")).not.toHaveText(before);
    });

    test("exports the piece in all three formats, named after the text", async ({ page }) => {
        await setText(page, "ANNA");
        await expect(stat(page, "Size")).toContainText("mm");

        const svg = await exportDefault(page);
        expect(svg.suggestedFilename()).toBe("ANNA.svg");
        for (const [label, ext] of [["DXF", "dxf"], ["FDS", "fds"]] as const) {
            const dl = await exportAs(page, new RegExp(`^${label}`));
            expect(dl.suggestedFilename()).toBe(`ANNA.${ext}`);
        }
    });

    test("empties the stage when the text is cleared, and lets you type again", async ({ page }) => {
        await page.getByLabel("Text", { exact: true }).fill("");
        await expect(page.getByTestId("empty-drop")).toBeVisible();
        await expect(page.getByTestId("empty-drop")).toContainText("Type something");
        await expect(page.getByTestId("export-button")).toBeDisabled();

        // The panel is the only way back in, so it must not empty itself with
        // the stage — an inspector that hides here locks the tool.
        await expect(page.getByTestId("inspector")).not.toContainText("Nothing on the canvas yet");
        await setText(page, "OK");
        await settled(page);
    });

    test("applies a preset and lets it be undone", async ({ page }) => {
        await page.getByRole("button", { name: /Stencil/ }).click();
        await expect(page.getByLabel("Border, exact value")).toHaveValue("6");
        await expect(page.getByRole("switch", { name: "Keyring hole" })).not.toBeChecked();

        await page.getByRole("button", { name: "Undo" }).click();
        await expect(page.getByLabel("Border, exact value")).toHaveValue("2.5");
    });

    test("hands the word on to the contour tracer", async ({ page }) => {
        await page.getByTestId("send-to").click();
        await page.getByRole("menuitem", { name: /Outer contour/ }).click();
        await expect(page).toHaveURL(/\/contour\/$/);
        await expect(page.getByTestId("sidebar")).toContainText("from Text");
    });
});
