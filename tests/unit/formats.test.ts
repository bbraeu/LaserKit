import { describe, expect, it, vi } from "vitest";
import { FORMATS, carriesRaster, designExports, textBlob } from "../../src/workspace/formats";

// The export menu is the one place that writes a file, so the two things worth
// pinning are the names it writes under (they are what the user goes looking
// for in their downloads folder) and the analytics events (they are configured
// by name in Google Analytics and a silent rename loses the history).

describe("designExports", () => {
    const spec = {
        stem: "logo_traced",
        eventPrefix: "TRACE",
        build: (fmt: "svg" | "dxf" | "fds") => textBlob(`<${fmt}/>`, fmt)
    };

    it("names the files after the design, with the format's extension", () => {
        expect(designExports(spec).map(o => o.filename)).toEqual([
            "logo_traced.svg",
            "logo_traced.dxf",
            "logo_traced.fds"
        ]);
    });

    it("keeps the analytics event names the site was configured with", () => {
        expect(designExports(spec).map(o => o.event)).toEqual([
            "TRACE_SVG_Download",
            "TRACE_DXF_Download",
            "TRACE_FDS_Download"
        ]);
    });

    it("leaves the converter's events unprefixed, as they were before the kit", () => {
        const a = designExports({ ...spec, eventPrefix: "", order: ["dxf", "fds", "svg"] });
        expect(a.map(o => o.event)).toEqual(["DXF_Download", "FDS_Download", "SVG_Download"]);
    });

    it("honours the order a tool asks for, so its default is first", () => {
        const a = designExports({ ...spec, order: ["dxf", "fds", "svg"] });
        expect(a[0]!.id).toBe("dxf");
    });

    it("does not build anything until a row is actually picked", () => {
        const build = vi.fn(() => new Blob());
        const a = designExports({ ...spec, build });
        expect(build).not.toHaveBeenCalled();
        void a[0]!.blob();
        expect(build).toHaveBeenCalledTimes(1);
    });

    it("carries a block reason through to the row", () => {
        const a = designExports({
            ...spec,
            blocked: fmt => (fmt === "svg" ? undefined : "vector geometry only")
        });
        expect(a.find(o => o.id === "svg")!.blocked).toBeUndefined();
        expect(a.find(o => o.id === "dxf")!.blocked).toBe("vector geometry only");
    });
});

describe("carriesRaster", () => {
    it("is true for SVG alone — DXF and FDS cannot hold a picture", () => {
        expect(carriesRaster("svg")).toBe(true);
        expect(carriesRaster("dxf")).toBe(false);
        expect(carriesRaster("fds")).toBe(false);
    });
});

describe("textBlob", () => {
    it("tags an SVG with the mime type a browser will preview", () => {
        expect(textBlob("<svg/>", "svg").type).toBe("image/svg+xml");
        expect(textBlob("0\nSECTION", "dxf").type).toBe(FORMATS.dxf.mime);
    });
});
