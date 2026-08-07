import { useCallback, useEffect, useState } from "react";
import type { ViewPrefs } from "../Stage";

// ---------------------------------------------------------------------------
// The chrome's own state: which panels are open, and how the stage is drawn.
//
// These are the only genuinely *global* settings in the app, which is why they
// live here and not in the inspector: they are true of the workspace rather than
// of the design, they survive a reload, and they follow you from tool to tool.
// The panels start closed on a narrow screen because the drawing wins ties.
// ---------------------------------------------------------------------------

const KEY = "laserkit:chrome";

/** Below this the panels float over the stage instead of taking space from it. */
export const FLOATING_BREAKPOINT = 1280;

export interface ChromeState {
    prefs: ViewPrefs;
    setPrefs: (patch: Partial<ViewPrefs>) => void;
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    toggleSidebar: () => void;
    toggleInspector: () => void;
    /** the panels are floating over the stage rather than beside it */
    floating: boolean;
}

interface Stored extends ViewPrefs {
    sidebar: boolean;
    inspector: boolean;
}

const DEFAULTS: Stored = { grid: true, rulers: true, centre: false, sidebar: true, inspector: true };

const read = (): Stored => {
    if (typeof localStorage === "undefined") return DEFAULTS;
    try {
        const o = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored>;
        const out = { ...DEFAULTS };
        for (const k of Object.keys(DEFAULTS) as (keyof Stored)[]) {
            if (typeof o[k] === "boolean") out[k] = o[k];
        }
        return out;
    } catch {
        return DEFAULTS;
    }
};

export function useWorkspaceChrome(): ChromeState {
    // Server-rendered first, so the stored value is read after mount — a value
    // read during render would make the first client paint disagree with the HTML.
    const [state, setState] = useState<Stored>(DEFAULTS);
    const [floating, setFloating] = useState(false);

    useEffect(() => {
        const stored = read(),
            bNarrow = window.innerWidth < FLOATING_BREAKPOINT;
        setFloating(bNarrow);
        // On a narrow screen the panels start out of the way whatever was stored:
        // two floating panels over a phone-width stage is no workspace at all.
        setState(bNarrow ? { ...stored, sidebar: false, inspector: false } : stored);

        const onResize = (): void => {
            const bNow = window.innerWidth < FLOATING_BREAKPOINT;
            setFloating(prev => {
                if (prev === bNow) return prev;
                // Crossing the line closes floating panels and restores docked ones.
                setState(s => (bNow ? { ...s, sidebar: false, inspector: false } : { ...s, ...read() }));
                return bNow;
            });
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    /** The one write path: merge, store, keep. */
    const update = useCallback((patch: Partial<Stored> | ((s: Stored) => Partial<Stored>)) => {
        setState(s => {
            const next = { ...s, ...(typeof patch === "function" ? patch(s) : patch) };
            try {
                localStorage.setItem(KEY, JSON.stringify(next));
            } catch {
                /* private mode — the preference simply does not persist */
            }
            return next;
        });
    }, []);

    const setPrefs = useCallback((patch: Partial<ViewPrefs>) => update(patch), [update]);
    const toggleSidebar = useCallback(() => update(s => ({ sidebar: !s.sidebar })), [update]);
    const toggleInspector = useCallback(() => update(s => ({ inspector: !s.inspector })), [update]);

    return {
        prefs: { grid: state.grid, rulers: state.rulers, centre: state.centre },
        setPrefs,
        sidebarOpen: state.sidebar,
        inspectorOpen: state.inspector,
        toggleSidebar,
        toggleInspector,
        floating
    };
}
