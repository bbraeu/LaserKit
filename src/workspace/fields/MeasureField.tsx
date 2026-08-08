import type { ReactNode } from "react";
import { Slider } from "../../components/ui/slider";
import { Field } from "./index";
import { NumberField } from "./NumberField";

// ---------------------------------------------------------------------------
// A measurement: the number, the unit it is in, and a slider under it.
//
// This is `SliderField` with two differences, and they are the reason it is a
// file of its own rather than two more flags on that one. Every tool in the kit
// renders through `SliderField` and their tests assert on the names it gives
// its controls, so a change there is a change to all fourteen.
//
//  · The slider's accessible name carries the value *and its unit* — "Kerf,
//    0.15 mm" rather than "Kerf, 0.15", which leaves the millimetres to be
//    guessed by the one person who cannot see the "mm" beside the box.
//  · Radix hands back min + n·step in floating point, so a 0.01 step lands on
//    0.15000000000000002 and the panel shows a kerf nobody typed.
//
// The read-out and the input are deliberately the same element. A formatted
// "4.0 mm" printed beside an editable box is the same number twice, and the one
// you correct has to be the exact one: somebody who knows their machine types
// 0.15 here and expects 0.15, not the nearest place a thumb can land.
// ---------------------------------------------------------------------------

/** Digits after the point a step of this size can actually reach. */
const decimalsOf = (step: number): number => (String(step).split(".")[1] ?? "").length;

export interface MeasureFieldProps {
    /** a string, because it is also what the two controls are named to a reader */
    label: string;
    hint?: ReactNode;
    value: number;
    onChange: (n: number) => void;
    min: number;
    max: number;
    step?: number;
    /** "" for a count — everything else is a physical size and says so */
    unit?: string;
    disabled?: boolean;
}

export function MeasureField({
    label, hint, value, onChange, min, max, step = 0.5, unit = "mm", disabled
}: MeasureFieldProps) {
    const digits = decimalsOf(step),
        shown = `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;

    return (
        <Field
            label={label}
            hint={hint}
            control={
                // Two controls for one value need two distinct names, or a screen
                // reader announces "Kerf, Kerf" and neither says which is which.
                <NumberField
                    label={`${label}, exact value`}
                    value={value}
                    min={min}
                    max={max}
                    unit={unit}
                    disabled={disabled}
                    onChange={onChange}
                />
            }
        >
            <Slider
                aria-label={`${label}, ${shown}`}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                // A value typed past the slider's end must not push the thumb off
                // the track; the field itself keeps the real number.
                value={[Math.min(max, Math.max(min, value))]}
                onValueChange={a => onChange(Number(a[0]!.toFixed(digits)))}
            />
        </Field>
    );
}
