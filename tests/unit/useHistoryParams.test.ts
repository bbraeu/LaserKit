import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { COALESCE_MS, useHistoryParams } from "../../src/workspace/hooks/useHistoryParams";

// Undo is new in this redesign and it is the thing most likely to be subtly
// wrong, because two of its rules pull against each other: a slider drag must
// be one step, and two deliberate nudges must be two. Both are pinned here,
// along with the promise that a per-file setting never leaks into the next file.

interface P {
    border: number;
    mode: string;
    /** belongs to the open file, not to the workshop */
    width: number;
}

const DEFAULTS: P = { border: 0, mode: "wrap", width: 0 };

/** A clock the test drives, so coalescing can be tested without waiting. */
const makeClock = () => {
    let t = 1000;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
};

describe("useHistoryParams", () => {
    beforeEach(() => localStorage.clear());

    it("starts at the defaults with nothing to undo", () => {
        const { result } = renderHook(() => useHistoryParams(DEFAULTS));
        expect(result.current.value).toEqual(DEFAULTS);
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });

    it("records a change and takes it back", () => {
        const { result } = renderHook(() => useHistoryParams(DEFAULTS));

        act(() => result.current.set({ border: 5 }, { label: "Border" }));
        expect(result.current.value.border).toBe(5);
        expect(result.current.canUndo).toBe(true);
        expect(result.current.undoLabel).toBe("Border");

        act(() => result.current.undo());
        expect(result.current.value.border).toBe(0);
        expect(result.current.canRedo).toBe(true);

        act(() => result.current.redo());
        expect(result.current.value.border).toBe(5);
    });

    it("collapses one slider drag into a single undo step", () => {
        const clock = makeClock();
        const { result } = renderHook(() => useHistoryParams(DEFAULTS, { now: clock.now }));

        act(() => {
            for (let n = 1; n <= 20; n++) {
                result.current.set({ border: n }, { label: "Border", coalesce: "border" });
            }
        });
        expect(result.current.value.border).toBe(20);

        act(() => result.current.undo());
        expect(result.current.value.border).toBe(0);
        expect(result.current.canUndo).toBe(false);
    });

    it("starts a new step once the drag has been let go of", () => {
        const clock = makeClock();
        const { result } = renderHook(() => useHistoryParams(DEFAULTS, { now: clock.now }));

        act(() => result.current.set({ border: 5 }, { label: "Border", coalesce: "border" }));
        clock.advance(COALESCE_MS + 1);
        act(() => result.current.set({ border: 9 }, { label: "Border", coalesce: "border" }));

        act(() => result.current.undo());
        expect(result.current.value.border).toBe(5);
        act(() => result.current.undo());
        expect(result.current.value.border).toBe(0);
    });

    it("never merges two different controls", () => {
        const clock = makeClock();
        const { result } = renderHook(() => useHistoryParams(DEFAULTS, { now: clock.now }));

        act(() => {
            result.current.set({ border: 5 }, { label: "Border", coalesce: "border" });
            result.current.set({ mode: "hull" }, { label: "Join method", coalesce: "mode" });
        });

        act(() => result.current.undo());
        expect(result.current.value).toMatchObject({ border: 5, mode: "wrap" });
    });

    it("drops the redo branch as soon as a new change is made", () => {
        const { result } = renderHook(() => useHistoryParams(DEFAULTS));
        act(() => result.current.set({ border: 5 }, { label: "Border" }));
        act(() => result.current.undo());
        expect(result.current.canRedo).toBe(true);

        act(() => result.current.set({ mode: "hull" }, { label: "Join method" }));
        expect(result.current.canRedo).toBe(false);
    });

    it("replace() changes settings without adding a step", () => {
        const { result } = renderHook(() => useHistoryParams(DEFAULTS));
        act(() => result.current.replace({ width: 40 }));
        expect(result.current.value.width).toBe(40);
        expect(result.current.canUndo).toBe(false);
    });

    it("jumps to any step of the history in one move", () => {
        const clock = makeClock();
        const { result } = renderHook(() => useHistoryParams(DEFAULTS, { now: clock.now }));

        for (const n of [1, 2, 3]) {
            clock.advance(COALESCE_MS + 1);
            act(() => result.current.set({ border: n }, { label: `Border ${n}` }));
        }
        // Four entries: the opening state plus three changes.
        expect(result.current.history).toHaveLength(4);
        expect(result.current.historyIndex).toBe(3);

        act(() => result.current.jumpTo(1));
        expect(result.current.value.border).toBe(1);
        expect(result.current.historyIndex).toBe(1);
        expect(result.current.canRedo).toBe(true);

        act(() => result.current.jumpTo(3));
        expect(result.current.value.border).toBe(3);
    });

    it("persists the durable settings and restores them next visit", () => {
        const { result, unmount } = renderHook(() =>
            useHistoryParams(DEFAULTS, { storageKey: "k", transient: ["width"] }));
        act(() => result.current.set({ border: 7, width: 40 }, { label: "Border" }));
        unmount();

        const second = renderHook(() =>
            useHistoryParams(DEFAULTS, { storageKey: "k", transient: ["width"] }));
        expect(second.result.current.value.border).toBe(7);
        // The width belonged to a file that is no longer open.
        expect(second.result.current.value.width).toBe(0);
    });

    it("ignores a stored value whose shape no longer matches", () => {
        localStorage.setItem("k", JSON.stringify({ border: "wide", mode: "hull" }));
        const { result } = renderHook(() => useHistoryParams(DEFAULTS, { storageKey: "k" }));
        expect(result.current.value.border).toBe(0);
        expect(result.current.value.mode).toBe("hull");
    });

    it("resetTransient() clears only the per-file settings", () => {
        const { result } = renderHook(() => useHistoryParams(DEFAULTS, { transient: ["width"] }));
        act(() => result.current.set({ border: 7, width: 40 }, { label: "Border" }));
        act(() => result.current.resetTransient());
        expect(result.current.value).toMatchObject({ border: 7, width: 0 });
    });

    it("reset() puts everything back as one undoable step", () => {
        const { result } = renderHook(() => useHistoryParams(DEFAULTS));
        act(() => result.current.set({ border: 7, mode: "hull" }, { label: "Border" }));
        act(() => result.current.reset());
        expect(result.current.value).toEqual(DEFAULTS);

        act(() => result.current.undo());
        expect(result.current.value).toMatchObject({ border: 7, mode: "hull" });
    });
});
