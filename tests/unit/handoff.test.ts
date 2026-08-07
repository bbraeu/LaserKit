import { describe, expect, it } from "vitest";
import { handoffFile, handoffTargets, takeHandoff } from "../../src/lib/handoff";

// Chaining tools is the feature people notice most, and its one failure mode is
// a design that gets re-imported on every reload — so "consumed on read" is the
// behaviour worth a test.

const KEY = "laserkit:handoff";

describe("handoff", () => {
    it("hands the design over exactly once", () => {
        sessionStorage.setItem(KEY, JSON.stringify({ svg: "<svg/>", name: "logo", from: "trace" }));

        const first = takeHandoff();
        expect(first).toMatchObject({ name: "logo", from: "trace" });
        // A reload must start from the empty stage, not silently re-import.
        expect(takeHandoff()).toBeNull();
    });

    it("ignores a payload that is not a design", () => {
        sessionStorage.setItem(KEY, JSON.stringify({ nope: true }));
        expect(takeHandoff()).toBeNull();
    });

    it("ignores an unparseable payload rather than throwing on load", () => {
        sessionStorage.setItem(KEY, "{ not json");
        expect(takeHandoff()).toBeNull();
    });

    it("turns the payload into the File the tools' own readers expect", () => {
        const f = handoffFile({ svg: "<svg/>", name: "logo_traced", from: "trace" });
        expect(f.name).toBe("logo_traced.svg");
        expect(f.type).toBe("image/svg+xml");
    });

    it("falls back to a name rather than writing '.svg'", () => {
        expect(handoffFile({ svg: "<svg/>", name: "", from: "trace" }).name).toBe("design.svg");
    });

    it("never offers to send a design to the tool it came from", () => {
        expect(handoffTargets("stamp")).not.toContain("stamp");
        expect(handoffTargets("stamp")).toContain("contour");
        // The converter and the tracer take a file, not a design, so both of the
        // design tools stay on offer from them.
        expect(handoffTargets("trace")).toEqual(["contour", "stamp"]);
    });
});
