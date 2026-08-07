import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { NumberField, SegmentedField, SliderField, ToggleField } from "../../src/workspace/fields";
import { PresetList } from "../../src/workspace/PresetList";

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

// The millimetre field is the subtlest control in the app: it has to let a
// half-typed number stand, or clearing it to type "12" puts the 1 next to the
// old value instead of replacing it. That is what these first tests are for.

function Harness({ initial = 3 }: { initial?: number }) {
    const [v, setV] = useState(initial);
    return (
        <>
            <NumberField label="Margin" value={v} min={0} max={60} onChange={setV} />
            <output data-testid="committed">{v}</output>
            <button onClick={() => setV(25)}>set from elsewhere</button>
        </>
    );
}

describe("NumberField", () => {
    it("lets the field go empty while a new number is typed", async () => {
        wrap(<Harness />);
        const input = screen.getByLabelText("Margin");

        await userEvent.clear(input);
        expect(input).toHaveValue(null);
        // Nothing was committed from an empty field.
        expect(screen.getByTestId("committed")).toHaveTextContent("3");

        await userEvent.type(input, "12");
        expect(input).toHaveValue(12);
        expect(screen.getByTestId("committed")).toHaveTextContent("12");
    });

    it("clamps to the range as you type", async () => {
        wrap(<Harness />);
        const input = screen.getByLabelText("Margin");
        await userEvent.clear(input);
        await userEvent.type(input, "500");
        expect(screen.getByTestId("committed")).toHaveTextContent("60");
    });

    it("follows a change that came from somewhere else — a slider beside it", async () => {
        wrap(<Harness />);
        await userEvent.click(screen.getByText("set from elsewhere"));
        expect(screen.getByLabelText("Margin")).toHaveValue(25);
    });
});

describe("SliderField", () => {
    it("names the slider and the number box apart", () => {
        wrap(<SliderField label="Border" value={4} min={0} max={100} onChange={vi.fn()} />);
        expect(screen.getByRole("slider", { name: "Border" })).toBeInTheDocument();
        expect(screen.getByLabelText("Border, exact value")).toHaveValue(4);
    });

    it("keeps the thumb inside the track when the value is out of range", () => {
        // A design width typed past the slider's end must not push the thumb off.
        wrap(<SliderField label="Border" value={500} min={0} max={100} onChange={vi.fn()} />);
        expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "100");
    });
});

describe("SegmentedField", () => {
    it("reports which choice is on", () => {
        wrap(
            <SegmentedField
                label="Shape"
                value="rect"
                choices={[{ id: "rect", label: "Rect" }, { id: "circle", label: "Circle" }]}
                onChange={vi.fn()}
            />
        );
        expect(screen.getByRole("radio", { name: "Rect" })).toHaveAttribute("data-state", "on");
    });

    it("ignores a press on the choice that is already on", async () => {
        const onChange = vi.fn();
        wrap(
            <SegmentedField
                label="Shape"
                value="rect"
                choices={[{ id: "rect", label: "Rect" }, { id: "circle", label: "Circle" }]}
                onChange={onChange}
            />
        );
        // Radix would clear the value; a segmented control has no "none".
        await userEvent.click(screen.getByRole("radio", { name: "Rect" }));
        expect(onChange).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole("radio", { name: "Circle" }));
        expect(onChange).toHaveBeenCalledWith("circle");
    });
});

describe("ToggleField", () => {
    it("flips", async () => {
        const onChange = vi.fn();
        wrap(<ToggleField label="Cut the plate out" checked={false} onChange={onChange} />);
        await userEvent.click(screen.getByRole("switch", { name: "Cut the plate out" }));
        expect(onChange).toHaveBeenCalledWith(true);
    });
});

describe("PresetList", () => {
    const presets = [
        { id: "a", label: "Exact contour", hint: "no border", patch: { border: 0, connect: false } },
        { id: "b", label: "Backing plate", hint: "3 mm", patch: { border: 3, connect: false } }
    ];

    it("marks the preset whose values are already in force", () => {
        render(
            <PresetList
                presets={presets}
                current={{ border: 3, connect: false, other: "ignored" }}
                onApply={vi.fn()}
            />
        );
        expect(screen.getByRole("button", { name: /Backing plate/ })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: /Exact contour/ })).toHaveAttribute("aria-pressed", "false");
    });

    it("applies the patch under the preset's own name, so undo can say it", async () => {
        const onApply = vi.fn();
        render(<PresetList presets={presets} current={{ border: 0, connect: false }} onApply={onApply} />);
        await userEvent.click(screen.getByRole("button", { name: /Backing plate/ }));
        expect(onApply).toHaveBeenCalledWith({ border: 3, connect: false }, "Backing plate");
    });
});
