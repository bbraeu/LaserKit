import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExportExtras, ExportMenu } from "../../src/workspace/ExportMenu";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import type { ExportItem } from "../../src/workspace/types";

// "Where do I export?" had four different answers in the old UI. It has one
// now, and these are the promises that one control makes.

const downloads: { name: string }[] = [];
vi.mock("../../src/lib/util", async importOriginal => {
    const actual = await importOriginal<typeof import("../../src/lib/util")>();
    return {
        ...actual,
        downloadBlob: (_blob: Blob, name: string) => { downloads.push({ name }); },
        trackEvent: vi.fn()
    };
});

const item = (o: Partial<ExportItem> & { id: string }): ExportItem => ({
    label: o.id.toUpperCase(),
    desc: "",
    filename: `design.${o.id}`,
    blob: () => new Blob(["x"]),
    event: `${o.id.toUpperCase()}_Download`,
    group: "design",
    ...o
});

const setup = (items: ExportItem[], active = "svg") => {
    const onActiveChange = vi.fn();
    render(
        <TooltipProvider>
            <ExportMenu items={items} active={active} onActiveChange={onActiveChange} />
        </TooltipProvider>
    );
    return { onActiveChange };
};

describe("ExportMenu", () => {
    it("writes the remembered format straight from the main button", async () => {
        downloads.length = 0;
        setup([item({ id: "svg" }), item({ id: "dxf" })], "dxf");

        await userEvent.click(screen.getByTestId("export-button"));
        await waitFor(() => expect(downloads).toEqual([{ name: "design.dxf" }]));
    });

    it("falls back to a usable format when the remembered one is blocked", async () => {
        downloads.length = 0;
        // A canvas with an image on it: only SVG can carry the picture.
        setup([
            item({ id: "svg" }),
            item({ id: "dxf", blocked: "vector geometry only" })
        ], "dxf");

        await userEvent.click(screen.getByTestId("export-button"));
        await waitFor(() => expect(downloads).toEqual([{ name: "design.svg" }]));
    });

    it("names the file it will write, so the button never has to", async () => {
        setup([item({ id: "svg", filename: "logo_traced.svg" })]);
        expect(screen.getByTestId("export-button")).toHaveAttribute("title", "Saves logo_traced.svg");
    });

    it("lists formats of the design and nothing else", async () => {
        setup([
            item({ id: "svg" }),
            item({ id: "dxf" }),
            // A companion file is not a format of the design; it gets its own
            // toolbar button rather than a row in the format list.
            item({ id: "parts", label: "Stamp parts sheet", group: "extra" })
        ]);

        await userEvent.click(screen.getByTestId("export-menu"));
        expect(await screen.findByText("The design as")).toBeInTheDocument();
        expect(screen.queryByText("Stamp parts sheet")).not.toBeInTheDocument();
    });

    it("remembers the format picked from the menu", async () => {
        downloads.length = 0;
        const { onActiveChange } = setup([item({ id: "svg" }), item({ id: "dxf" })], "svg");

        await userEvent.click(screen.getByTestId("export-menu"));
        await userEvent.click(await screen.findByText("DXF"));

        expect(onActiveChange).toHaveBeenCalledWith("dxf");
        await waitFor(() => expect(downloads).toEqual([{ name: "design.dxf" }]));
    });

    it("says why a format is unavailable instead of just greying it out", async () => {
        setup([item({ id: "svg" }), item({ id: "dxf", blocked: "vector geometry only" })]);

        await userEvent.click(screen.getByTestId("export-menu"));
        expect(await screen.findByText("vector geometry only")).toBeInTheDocument();
        expect(screen.getByText("unavailable")).toBeInTheDocument();
    });

    it("is dead while there is nothing to export", () => {
        render(
            <TooltipProvider>
                <ExportMenu items={[]} active="" onActiveChange={vi.fn()} disabled />
            </TooltipProvider>
        );
        expect(screen.getByTestId("export-button")).toBeDisabled();
    });

    it("does not offer the design's own formats as companion buttons", () => {
        render(<ExportExtras items={[item({ id: "svg" }), item({ id: "dxf" })]} />);
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
});

describe("ExportExtras", () => {
    it("gives each companion file its own named button", async () => {
        downloads.length = 0;
        render(
            <ExportExtras
                items={[
                    item({ id: "svg" }),
                    item({ id: "parts", label: "Stamp parts sheet", filename: "badge_stamp_parts.svg", group: "extra" }),
                    item({ id: "zip", label: "All 3 canvases (.zip)", filename: "demo.zip", group: "extra" })
                ]}
            />
        );

        expect(screen.getByText("Stamp parts sheet")).toBeInTheDocument();
        await userEvent.click(screen.getByTestId("export-extra-parts"));
        await waitFor(() => expect(downloads).toEqual([{ name: "badge_stamp_parts.svg" }]));

        await userEvent.click(screen.getByTestId("export-extra-zip"));
        await waitFor(() => expect(downloads).toHaveLength(2));
    });

    it("says on the button why a companion file cannot be written", () => {
        render(<ExportExtras items={[item({ id: "zip", group: "extra", blocked: "only one canvas" })]} />);
        const b = screen.getByTestId("export-extra-zip");
        expect(b).toBeDisabled();
        expect(b).toHaveAttribute("title", "only one canvas");
    });
});
