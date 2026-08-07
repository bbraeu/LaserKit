import { useCallback } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDebouncedBuild } from "../../src/workspace/hooks/useDebouncedBuild";

// The bug this hook exists to make impossible: a fit key derived beside the
// result rather than published with it. A new design width reaches the
// component one render before the geometry it rescales, so the view would refit
// to the drawing on its way out and leave the incoming one at the wrong zoom.
//
// Note the useCallback in every test. That is the hook's contract, not test
// ceremony: the builder's identity is the "settings changed" signal.

describe("useDebouncedBuild", () => {
    it("publishes the result and its fit key in the same update", async () => {
        const seen: { result: string | null; fitKey: string }[] = [];
        const build = (i: string) => `built:${i}`;

        const { rerender } = renderHook(
            ({ input, fitKey }: { input: string; fitKey: string }) => {
                const s = useDebouncedBuild({ input, build, fitKey, fallbackError: "no", delay: 1 });
                seen.push({ result: s.result, fitKey: s.fitKey });
                return s;
            },
            { initialProps: { input: "a", fitKey: "key-a" } }
        );

        await waitFor(() => expect(seen.at(-1)!.result).toBe("built:a"));
        rerender({ input: "b", fitKey: "key-b" });
        await waitFor(() => expect(seen.at(-1)!.result).toBe("built:b"));

        // No render may ever have shown one drawing's result under another's key.
        for (const o of seen) {
            if (o.result === "built:a") expect(o.fitKey).toBe("key-a");
            if (o.result === "built:b") expect(o.fitKey).toBe("key-b");
        }
    });

    it("builds once for a burst of changes", async () => {
        vi.useFakeTimers();
        const build = vi.fn((n: number) => n * 2);

        const { rerender } = renderHook(
            ({ input }: { input: number }) =>
                useDebouncedBuild({ input, build, fitKey: "k", fallbackError: "no", delay: 30 }),
            { initialProps: { input: 1 } }
        );
        for (const n of [2, 3, 4, 5]) rerender({ input: n });

        expect(build).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(40); });
        expect(build).toHaveBeenCalledTimes(1);
        expect(build).toHaveBeenCalledWith(5);
    });

    it("marks itself pending between a change and its result", async () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => {
            const build = useCallback((n: number) => n, []);
            return useDebouncedBuild({ input: 1, build, fitKey: "k", fallbackError: "no", delay: 30 });
        });

        expect(result.current.pending).toBe(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(40); });
        expect(result.current.pending).toBe(false);
        expect(result.current.result).toBe(1);
    });

    it("reports a builder's own message and drops the stale result", async () => {
        const build = (): number => { throw new Error("This design has no geometry."); };
        const { result } = renderHook(() =>
            useDebouncedBuild({ input: 1, build, fitKey: "k", fallbackError: "Building failed.", delay: 1 }));

        await waitFor(() => expect(result.current.error).toBe("This design has no geometry."));
        expect(result.current.result).toBeNull();
    });

    it("falls back to the tool's wording for an unprintable throw", async () => {
        const build = (): number => { throw new Error("x".repeat(500)); };
        const { result } = renderHook(() =>
            useDebouncedBuild({ input: 1, build, fitKey: "k", fallbackError: "Building failed.", delay: 1 }));

        await waitFor(() => expect(result.current.error).toBe("Building failed."));
    });

    it("does nothing at all while there is no input", async () => {
        const build = vi.fn();
        renderHook(() =>
            useDebouncedBuild({ input: null, build, fitKey: "k", fallbackError: "no", delay: 1 }));
        await new Promise(r => setTimeout(r, 20));
        expect(build).not.toHaveBeenCalled();
    });
});
