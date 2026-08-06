import { useEffect, useRef, useState } from "react";

/**
 * A millimetre input that lets a half-typed value stand.
 *
 * Clearing the field to type a new number leaves it momentarily empty — and "-"
 * or "1." are not numbers either — so a plainly controlled input would snap back
 * to the old value between the two keystrokes, and the new digit would land next
 * to it instead of replacing it. The text is therefore state of its own; the
 * committed value only follows once the text parses, and the text only follows
 * the value when something *else* changed it, which is what a slider beside the
 * field does.
 */
export interface NumberFieldProps {
    value: number;
    onChange: (n: number) => void;
    label: string;
    min?: number;
    max?: number;
    /** appended after the input, e.g. "mm" */
    unit?: string;
    className?: string;
}

/** How every editable field in the kit looks — inputs here, selects at the call sites. */
export const FIELD_CLASS = "rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-slate-200 outline-none transition hover:border-cyan-400/50 focus-visible:border-cyan-400/60";

export function NumberField({ value, onChange, label, min, max, unit = "mm", className = "w-20" }: NumberFieldProps) {
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
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <input
                type="number"
                aria-label={label}
                min={min}
                max={max}
                step="any"
                value={text}
                onChange={e => onText(e.target.value)}
                onBlur={() => setText(String(value))}
                className={`${className} ${FIELD_CLASS} tabular-nums`}
            />
            {unit}
        </span>
    );
}
