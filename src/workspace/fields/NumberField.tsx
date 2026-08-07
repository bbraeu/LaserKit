import { useEffect, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/cn";

/**
 * A millimetre input that lets a half-typed value stand.
 *
 * Clearing the field to type a new number leaves it momentarily empty — and "-"
 * or "1." are not numbers either — so a plainly controlled input would snap back
 * to the old value between two keystrokes and the new digit would land next to
 * it instead of replacing it. The text is therefore state of its own; the
 * committed value only follows once the text parses, and the text only follows
 * the value when something *else* changed it, which is what the slider beside
 * the field does.
 */
export interface NumberFieldProps {
    value: number;
    onChange: (n: number) => void;
    /** what a screen reader announces; the visible label is the row's */
    label: string;
    min?: number;
    max?: number;
    /** appended after the input; "" for a bare number */
    unit?: string;
    className?: string;
    disabled?: boolean;
    id?: string;
}

export function NumberField({
    value, onChange, label, min, max, unit = "mm", className, disabled, id
}: NumberFieldProps) {
    const [text, setText] = useState(() => String(value));
    // The last value this field itself put out, so a change from elsewhere can be
    // told apart from the echo of our own.
    const mineRef = useRef(value);

    useEffect(() => {
        if (value === mineRef.current) return;
        mineRef.current = value;
        setText(String(value));
    }, [value]);

    const onText = (s: string): void => {
        setText(s);
        const n = parseFloat(s);
        if (!isFinite(n)) return;
        const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
        mineRef.current = c;
        onChange(c);
    };

    return (
        <span className={cn("flex shrink-0 items-center gap-1", className)}>
            <Input
                id={id}
                type="number"
                aria-label={label}
                min={min}
                max={max}
                step="any"
                disabled={disabled}
                value={text}
                onChange={e => onText(e.target.value)}
                onBlur={() => setText(String(value))}
                className="w-16 text-right tabular-nums"
            />
            {unit && <span className="w-4 shrink-0 text-[10px] text-subtle-foreground">{unit}</span>}
        </span>
    );
}
