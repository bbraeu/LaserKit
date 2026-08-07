import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// The files the end-to-end tests drop on the workspace.
//
// Built in code rather than committed as binaries so that what each one
// contains is readable: "two 20 mm squares 15 mm apart" is a sentence a failing
// selection test can be reasoned about from, and a checked-in .svg is not.
// ---------------------------------------------------------------------------

export interface Fixture {
    name: string;
    mimeType: string;
    buffer: Buffer;
}

const file = (name: string, mimeType: string, body: string | Buffer): Fixture => ({
    name,
    mimeType,
    buffer: Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8")
});

// --- SVG -------------------------------------------------------------------

/** A 36 × 21 mm frame with a hole in it, on a 40 × 25 mm page. */
export const svgOneItem = (): Fixture => file(
    "badge.svg",
    "image/svg+xml",
    `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="25mm" viewBox="0 0 40 25">
        <path d="M2 2 H38 V23 H2 Z M10 8 H30 V17 H10 Z" fill="#000" fill-rule="evenodd"/>
     </svg>`
);

/** Two 20 mm squares with a 15 mm gap — the case the contour tool joins. */
export const svgTwoItems = (): Fixture => file(
    "pair.svg",
    "image/svg+xml",
    `<svg xmlns="http://www.w3.org/2000/svg" width="55mm" height="20mm" viewBox="0 0 55 20">
        <rect x="0" y="0" width="20" height="20" fill="#000"/>
        <rect x="35" y="0" width="20" height="20" fill="#000"/>
     </svg>`
);

/** An SVG with no physical size at all — the "96 dpi was assumed" path. */
export const svgNoSize = (): Fixture => file(
    "unsized.svg",
    "image/svg+xml",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
        <rect x="10" y="10" width="80" height="40" fill="#000"/>
     </svg>`
);

// --- PNG -------------------------------------------------------------------

const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]),
        tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([head, body, tail]);
};

/**
 * A greyscale PNG, built here so the tests never depend on a checked-in binary.
 * `ink(x, y)` decides each pixel: true is black, and black is what gets traced.
 */
export const png = (w: number, h: number, ink: (x: number, y: number) => boolean): Buffer => {
    // One filter byte per row (0 = none), then one grey byte per pixel.
    const raw = Buffer.alloc(h * (w + 1));
    for (let y = 0; y < h; y++) {
        raw[y * (w + 1)] = 0;
        for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = ink(x, y) ? 0 : 255;
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 0;  // colour type: greyscale
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0))
    ]);
};

/** A filled disc on white — something with a curve in it for Smooth to act on. */
export const pngDisc = (): Fixture => file(
    "disc.png",
    "image/png",
    png(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < 45)
);

/** A cross of 6 px strokes — what a centreline trace is actually for. */
export const pngStrokes = (): Fixture => file(
    "cross.png",
    "image/png",
    png(120, 120, (x, y) => (Math.abs(x - 60) < 3 && y > 15 && y < 105) || (Math.abs(y - 60) < 3 && x > 15 && x < 105))
);

// --- xTool project ---------------------------------------------------------

/**
 * A minimal but genuine .xcs: two canvases, one shape each, with the device
 * entry that says which operation the shape belongs to. Without that entry the
 * converter has nothing to colour-code, which is the whole point of it.
 */
export const xcsProject = (): Fixture => {
    const display = (id: string, dPath: string) => ({
        id,
        type: "PATH",
        x: 0,
        y: 0,
        graphicX: 0,
        graphicY: 0,
        width: 40,
        height: 25,
        isFill: false,
        dPath
    });

    const canvasEntry = (ids: [string, string][]) => ({
        mode: "1",
        data: { "1": { material: 0, thickness: 3, focalLength: 8, fanGear: 2, xcsUsed: ["material", "thickness", "focalLength", "fanGear"] } },
        displays: {
            value: ids.map(([id, type]) => [id, {
                processingType: type,
                data: {
                    [type]: {
                        materialType: "customize",
                        // The parameter set is keyed by materialType, not by the
                        // operation — getParameters() looks up "customize" here.
                        parameter: {
                            customize: { power: 80, speed: 300, repeat: 1, density: 300, processingLightSource: "blue" }
                        }
                    }
                }
            }])
        }
    });

    const project = {
        canvas: [
            { id: "c1", title: "{panel}1", displays: [display("d1", "M2 2 H38 V23 H2 Z"), display("d2", "M10 8 H30 V17 H10 Z")] },
            { id: "c2", title: "{panel}2", displays: [display("d3", "M0 0 H30 V30 H0 Z")] }
        ],
        extId: "S1",
        extName: "xTool S1",
        version: "2.3.0",
        modify: Date.UTC(2025, 0, 15) / 1000,
        ua: "web",
        device: {
            power: [10],
            data: {
                value: [
                    ["c1", canvasEntry([["d1", "VECTOR_CUTTING"], ["d2", "VECTOR_ENGRAVING"]])],
                    ["c2", canvasEntry([["d3", "FILL_VECTOR_ENGRAVING"]])]
                ]
            }
        }
    };

    return file("demo.xcs", "application/json", JSON.stringify(project));
};
