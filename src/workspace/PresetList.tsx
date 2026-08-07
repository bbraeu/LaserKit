import { Check } from "lucide-react";
import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// Starting points.
//
// The honest reason these exist: the settings that make a good keychain backing
// or a good round stamp are known, and making every user rediscover them by
// dragging sliders is the tax the old UI charged. A preset is nothing clever —
// a named patch of the settings object — but it turns "what should the border
// be?" into a click, and because it goes through the same set() as a slider it
// lands in the history and can be undone like anything else.
// ---------------------------------------------------------------------------

export interface Preset<T> {
    id: string;
    label: string;
    hint: string;
    patch: Partial<T>;
}

export interface PresetListProps<T extends object> {
    presets: Preset<T>[];
    current: T;
    onApply: (patch: Partial<T>, label: string) => void;
}

/** A preset is "on" when every value it names already matches. */
const matches = <T extends object>(current: T, patch: Partial<T>): boolean =>
    (Object.keys(patch) as (keyof T)[]).every(k => Object.is(current[k], patch[k]));

export function PresetList<T extends object>({ presets, current, onApply }: PresetListProps<T>) {
    return (
        <ul className="space-y-0.5">
            {presets.map(o => {
                const on = matches(current, o.patch);
                return (
                    <li key={o.id}>
                        <button
                            onClick={() => onApply(o.patch, o.label)}
                            aria-pressed={on}
                            className={cn(
                                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                                on ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                            )}
                        >
                            <span className="mt-0.5 grid size-3 shrink-0 place-items-center">
                                {on && <Check className="size-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-xs font-medium">{o.label}</span>
                                <span className="mt-0.5 block text-[11px] leading-snug text-subtle-foreground">{o.hint}</span>
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
