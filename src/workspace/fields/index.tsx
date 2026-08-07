import { useId } from "react";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Hint } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { NumberField } from "./NumberField";

// ---------------------------------------------------------------------------
// The inspector's vocabulary.
//
// The old UI wrote out "label, number box, range input, eleven-word explanation"
// by hand roughly ten times, and the copies had drifted: some hints sat above
// the slider, some below, two used a different grey, one had no label element at
// all. Every one of those is now a single call, which is the only way a panel of
// twenty controls can look like one panel.
//
// The other decision here is that a hint is never printed under a control. Long
// prose in a properties panel is what made the old one feel like a manual; it
// goes behind an ⓘ instead, one hover away, where it is still there for the
// person who needs it and invisible to the person who does not.
// ---------------------------------------------------------------------------

export { NumberField } from "./NumberField";

/** The label / control row every field is built on. */
export function Field({ label, hint, htmlFor, control, className, children }: {
    label: ReactNode;
    hint?: ReactNode;
    htmlFor?: string;
    /** sits on the right of the label row — a number box, a switch */
    control?: ReactNode;
    className?: string;
    /** the wide part, under the row — a slider, a segmented control */
    children?: ReactNode;
}) {
    return (
        <div className={cn("py-1", className)}>
            <div className="flex min-h-6 items-center gap-2">
                <label
                    htmlFor={htmlFor}
                    className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium text-foreground"
                >
                    <span className="truncate">{label}</span>
                    {hint && (
                        <Hint label={hint} side="left">
                            <button
                                type="button"
                                tabIndex={-1}
                                aria-label="What this does"
                                className="shrink-0 text-subtle-foreground transition-colors hover:text-accent"
                            >
                                <Info className="size-3" />
                            </button>
                        </Hint>
                    )}
                </label>
                {control}
            </div>
            {children && <div className="mt-1.5">{children}</div>}
        </div>
    );
}

/** Label, number box and slider — the workhorse of every tool's inspector. */
export function SliderField({
    label, hint, value, onChange, min, max, step = 0.5, unit = "mm", disabled, commitKey
}: {
    label: ReactNode;
    hint?: ReactNode;
    value: number;
    onChange: (n: number) => void;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    disabled?: boolean;
    /** identifies the drag for undo coalescing; defaults to the label */
    commitKey?: string;
}) {
    const name = typeof label === "string" ? label : String(commitKey ?? "value");
    return (
        <Field
            label={label}
            hint={hint}
            control={
                // Two controls for one value need two distinct names, or a screen
                // reader announces "Border, Border" and neither says which is which.
                <NumberField
                    label={`${name}, exact value`}
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
                aria-label={name}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                // A value typed past the slider's end must not push the thumb off
                // the track; the field itself keeps the real number.
                value={[Math.min(max, Math.max(min, value))]}
                onValueChange={a => onChange(a[0]!)}
            />
        </Field>
    );
}

/** A switch with its label — for anything that is simply on or off. */
export function ToggleField({ label, hint, checked, onChange, disabled }: {
    label: ReactNode;
    hint?: ReactNode;
    checked: boolean;
    onChange: (b: boolean) => void;
    disabled?: boolean;
}) {
    const id = useId();
    return (
        <Field
            label={label}
            hint={hint}
            htmlFor={id}
            control={
                <Switch
                    id={id}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={onChange}
                    aria-label={typeof label === "string" ? label : undefined}
                />
            }
        />
    );
}

export interface Choice<T extends string> {
    id: T;
    label: string;
    hint?: string;
    icon?: ReactNode;
}

/** Two to four mutually exclusive choices, all of them visible. */
export function SegmentedField<T extends string>({ label, hint, value, choices, onChange, disabled }: {
    label?: ReactNode;
    hint?: ReactNode;
    value: T;
    choices: Choice<T>[];
    onChange: (v: T) => void;
    disabled?: boolean;
}) {
    const group = (
        <ToggleGroup
            type="single"
            value={value}
            disabled={disabled}
            aria-label={typeof label === "string" ? label : undefined}
            // Radix clears the value when the pressed item is pressed again; a
            // segmented control has no "none", so an empty change is ignored.
            onValueChange={(v: string) => { if (v) onChange(v as T); }}
        >
            {choices.map(o => (
                <ToggleGroupItem key={o.id} value={o.id} title={o.hint}>
                    {o.icon}
                    {o.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
    return label ? <Field label={label} hint={hint}>{group}</Field> : <div className="py-1">{group}</div>;
}

/** More choices than fit across, or ones whose names are long. */
export function SelectField<T extends string>({ label, hint, value, choices, onChange, disabled, placeholder }: {
    label: ReactNode;
    hint?: ReactNode;
    value: T;
    choices: Choice<T>[];
    onChange: (v: T) => void;
    disabled?: boolean;
    placeholder?: string;
}) {
    return (
        <Field label={label} hint={hint}>
            <Select value={value} disabled={disabled} onValueChange={v => onChange(v as T)}>
                <SelectTrigger aria-label={typeof label === "string" ? label : undefined}>
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {choices.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    );
}

/** Two numbers that belong together: width × height. */
export function PairField({ label, hint, w, h, onW, onH, min = 1, locked, unit = "mm", disabled }: {
    label: ReactNode;
    hint?: ReactNode;
    w: number;
    h: number;
    onW: (n: number) => void;
    onH: (n: number) => void;
    min?: number;
    /** one value drives both — a circle has a diameter, not a width and a height */
    locked?: boolean;
    unit?: string;
    disabled?: boolean;
}) {
    return (
        <Field label={label} hint={hint}>
            <div className="flex items-center gap-1.5">
                <NumberField label="Width" value={w} min={min} unit={locked ? `${unit} ⌀` : unit}
                    disabled={disabled} onChange={onW} />
                {!locked && (
                    <>
                        <span className="text-[10px] text-subtle-foreground">×</span>
                        <NumberField label="Height" value={h} min={min} unit={unit}
                            disabled={disabled} onChange={onH} />
                    </>
                )}
            </div>
        </Field>
    );
}

/** A read-only pair of facts — what the tool worked out, not what you set. */
export function ReadoutGrid({ items }: { items: { label: string; value: string }[] }) {
    return (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            {items.map(o => (
                <div key={o.label} className="min-w-0">
                    <dt className="truncate text-[10px] tracking-wide text-subtle-foreground uppercase">{o.label}</dt>
                    <dd className="truncate text-xs text-foreground tabular-nums" title={o.value}>{o.value}</dd>
                </div>
            ))}
        </dl>
    );
}
