import { useCallback, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Every tool's settings, with undo.
//
// A tool used to be a fistful of independent useState calls, which is why the
// toolbar could not offer Undo: there was nothing to undo *to*. Here the whole
// setting set is one object with a past and a future, so "I nudged the border
// and preferred it before" is one keystroke instead of a re-drag.
//
// Two things make that bearable in practice:
//
//  · Coalescing. Dragging a slider fires a set per pixel of travel; without it
//    one drag would cost fifty undo steps. Consecutive changes naming the same
//    `coalesce` key inside COALESCE_MS collapse into one entry, so a drag is a
//    single step however long it took.
//  · Transient keys. A design's width override or a picked selection belong to
//    the file that is open, not to the workshop — those are named up front, and
//    are the only ones a new file resets and the only ones never persisted.
// ---------------------------------------------------------------------------

/** Consecutive changes with the same coalesce key merge for this long. */
export const COALESCE_MS = 700;

/** Beyond this the oldest steps are dropped — nobody undoes 200 nudges. */
const HISTORY_LIMIT = 100;

export interface Change {
    /** what the toolbar's Undo tooltip says: "Undo Border" */
    label?: string;
    /** changes sharing a key inside COALESCE_MS become one undo step */
    coalesce?: string;
}

/** One step, as the sidebar's history list shows it. */
export interface HistoryEntry {
    /** what the change was called; the first entry has none */
    label?: string;
}

/**
 * The half of the settings API that is not about their *type* — undo, redo,
 * reset and the step list. The chrome takes only this, so the toolbar and the
 * sidebar never need to know what a given tool's settings look like.
 */
export interface HistoryControls {
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    /** what undo / redo would take back, for the tooltip */
    undoLabel?: string;
    redoLabel?: string;
    /** back to the tool's defaults, as one undo step */
    reset: () => void;
    /** past, present and future as one list, oldest first */
    history: HistoryEntry[];
    /** where in that list the present is */
    historyIndex: number;
    /** go to a step of it — undo and redo in one move, however far */
    jumpTo: (index: number) => void;
}

export interface ParamsApi<T extends object> extends HistoryControls {
    value: T;
    /** change some settings; one undo step unless coalesced into the last */
    set: (patch: Partial<T>, change?: Change) => void;
    /** change settings *without* a history entry — for a new file landing */
    replace: (patch: Partial<T>) => void;
    /** the transient settings back to their defaults, without a history entry */
    resetTransient: () => void;
}

interface Entry<T> {
    value: T;
    label?: string;
    coalesce?: string;
    at: number;
}

export interface HistoryOptions<T extends object> {
    /** localStorage key; the non-transient settings survive a reload under it */
    storageKey?: string;
    /** settings that belong to the open file rather than to the workshop */
    transient?: (keyof T)[];
    /** injected by the tests; the default is Date.now */
    now?: () => number;
}

const loadDurable = <T extends object>(key: string | undefined, defaults: T, transient: (keyof T)[]): T => {
    if (!key || typeof localStorage === "undefined") return defaults;
    try {
        const s = localStorage.getItem(key);
        if (!s) return defaults;
        const stored = JSON.parse(s) as Partial<T>;
        // Merged over the defaults rather than used as-is: a setting added since
        // the last visit is then present instead of undefined, and a stored value
        // of the wrong shape (an old release) is ignored rather than trusted.
        const out = { ...defaults };
        for (const k of Object.keys(stored) as (keyof T)[]) {
            if (k in defaults && !transient.includes(k) && typeof stored[k] === typeof defaults[k]) {
                out[k] = stored[k] as T[keyof T];
            }
        }
        return out;
    } catch {
        return defaults;
    }
};

const saveDurable = <T extends object>(key: string | undefined, value: T, transient: (keyof T)[]): void => {
    if (!key || typeof localStorage === "undefined") return;
    try {
        const out: Partial<T> = {};
        for (const k of Object.keys(value) as (keyof T)[]) {
            if (!transient.includes(k)) out[k] = value[k];
        }
        localStorage.setItem(key, JSON.stringify(out));
    } catch {
        /* private mode or a full quota — the settings simply do not persist */
    }
};

export function useHistoryParams<T extends object>(defaults: T, options: HistoryOptions<T> = {}): ParamsApi<T> {
    // All three are literals at the call site, so a new identity every render.
    // Pinned once, or every callback below would change on each render and the
    // memoised children under the inspector would re-render with them.
    const cfg = useRef({ defaults, ...options });

    const [present, setPresent] = useState<Entry<T>>(() => ({
        value: loadDurable(cfg.current.storageKey, defaults, cfg.current.transient ?? []),
        at: 0
    }));
    const [past, setPast] = useState<Entry<T>[]>([]);
    const [future, setFuture] = useState<Entry<T>[]>([]);

    /** The one write path: merge a patch in, optionally recording a step. */
    const apply = useCallback((patch: Partial<T>, change: Change | null) => {
        const { storageKey, transient = [], now = Date.now } = cfg.current;
        setPresent(prev => {
            const value = { ...prev.value, ...patch };
            if (change) {
                const bMerge = !!change.coalesce
                    && prev.coalesce === change.coalesce
                    && now() - prev.at < COALESCE_MS;
                if (!bMerge) setPast(a => [...a.slice(-(HISTORY_LIMIT - 1)), prev]);
                setFuture([]);
            }
            saveDurable(storageKey, value, transient);
            return {
                value,
                // A history-less change keeps the label of the step it edits, so
                // the sidebar's list does not sprout an unnamed entry for a file
                // landing; it clears the coalesce key, so the next real change
                // cannot merge into whatever came before that file.
                label: change?.label ?? (change ? undefined : prev.label),
                coalesce: change?.coalesce,
                at: now()
            };
        });
    }, []);

    const set = useCallback((patch: Partial<T>, change: Change = {}) => apply(patch, change), [apply]);
    const replace = useCallback((patch: Partial<T>) => apply(patch, null), [apply]);

    /** Undo and redo are the same move in opposite directions. */
    const step = useCallback((bBack: boolean) => {
        const { storageKey, transient = [], now = Date.now } = cfg.current;
        const from = bBack ? setPast : setFuture,
            to = bBack ? setFuture : setPast;
        from(a => {
            const entry = bBack ? a[a.length - 1] : a[0];
            if (!entry) return a;
            setPresent(cur => {
                to(b => (bBack ? [cur, ...b] : [...b, cur]));
                saveDurable(storageKey, entry.value, transient);
                return { ...entry, coalesce: undefined, at: now() };
            });
            return bBack ? a.slice(0, -1) : a.slice(1);
        });
    }, []);

    const undo = useCallback(() => step(true), [step]);
    const redo = useCallback(() => step(false), [step]);

    const reset = useCallback(() => {
        apply({ ...cfg.current.defaults }, { label: "Reset settings" });
    }, [apply]);

    const resetTransient = useCallback(() => {
        const patch: Partial<T> = {};
        for (const k of cfg.current.transient ?? []) patch[k] = cfg.current.defaults[k];
        apply(patch, null);
    }, [apply]);

    /** Any number of steps in either direction, as one move. */
    const jumpTo = useCallback((index: number) => {
        const { storageKey, transient = [], now = Date.now } = cfg.current,
            all = [...past, present, ...future],
            target = all[index];
        if (!target || index === past.length) return;
        setPast(all.slice(0, index));
        setFuture(all.slice(index + 1));
        setPresent({ ...target, coalesce: undefined, at: now() });
        saveDurable(storageKey, target.value, transient);
    }, [past, present, future]);

    return useMemo(() => ({
        value: present.value,
        set,
        replace,
        undo,
        redo,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        undoLabel: past.length ? present.label : undefined,
        redoLabel: future[0]?.label,
        reset,
        resetTransient,
        history: [...past, present, ...future].map(o => ({ label: o.label })),
        historyIndex: past.length,
        jumpTo
    }), [present, past, future, set, replace, undo, redo, reset, resetTransient, jumpTo]);
}
