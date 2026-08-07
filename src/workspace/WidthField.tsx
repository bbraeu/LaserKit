import { Ruler } from "lucide-react";
import { PanelSection } from "./PanelSection";
import { Field, NumberField } from "./fields";

// An SVG that states no physical size, and a bitmap, both leave the same hole:
// nobody knows how big the thing is meant to be, so 96 dpi is assumed on its
// units and every millimetre figure in the app follows that guess. All three
// tools that can hit it asked the same question in three slightly different
// wordings; this is the question.

export interface WidthFieldProps {
    /** the width in mm the user typed, or 0 while the guess stands */
    value: number;
    /** what 96 dpi made of it — shown while nothing has been typed */
    guess: number;
    onChange: (n: number) => void;
    /** why it matters for this tool, appended to the shared explanation */
    because: string;
    /** "Design width" for a vector source, "Traced width" for a bitmap */
    label?: string;
    /** the tracer always asks; the others only for an SVG that was silent */
    reason?: string;
}

export function WidthField({ value, guess, onChange, because, label = "Design width", reason }: WidthFieldProps) {
    return (
        <PanelSection id="width-override" title="Real size" icon={<Ruler className="size-3" />}>
            <Field
                label={label}
                hint={`${reason ?? "This file carries no physical size, so 96 dpi was assumed on its units."} ${because}`}
                control={
                    <NumberField
                        label={`${label} in millimetres`}
                        value={value || Math.round(guess * 10) / 10}
                        min={1}
                        onChange={onChange}
                    />
                }
            />
            <p className="text-[11px] leading-relaxed text-subtle-foreground">
                {reason ?? "No physical size in the file — 96 dpi assumed."} Set the width it should really be.
            </p>
        </PanelSection>
    );
}
