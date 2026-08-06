import { unzipSync, strFromU8 } from "fflate";
import type {
    XcsProject, XcsCanvas, XcsDisplay, XcsDeviceCanvasEntry, XcsDeviceDisplayConfig,
    XcsModeData, XcsParameters
} from "./convert";

// ---------------------------------------------------------------------------
// .xs project files (xTool Studio, "xcs-workspace-v2")
//
// A .xs file is a ZIP archive holding the same data model as a v1 .xcs, split
// into parts:
//   project.json                          canvas order, active device id
//   canvases/<id>.json                    canvas metadata (title, chunk layout)
//   canvases/<id>/displays-<n>.json       display objects, chunked
//   vectors/<bucket>/data-<n>.json        deduplicated geometry (e.g. dPath
//                                         strings) referenced via vectorRef
//   resources/<hash>.<ext>                raster images, referenced by a
//                                         display's resourcePath
//   profiles.json                         profileId -> processingType, values
//   devices/device-<id>.json              processing[canvasId].modes[mode]
//                                         .bindings: profile -> displayIds
//                                         .patches:  parameter overrides
//
// This module reassembles those parts into the v1 XcsProject shape so the
// whole SVG/DXF/FDS pipeline works unchanged.
// ---------------------------------------------------------------------------

interface XsProjectJson {
    activeDeviceId?: string;
    created?: number;
    modify?: number;
    /** archive path of the cover image, e.g. "resources/project-cover.png" */
    cover?: string;
    versionInfo?: { appVersion?: string; ua?: string; savedAt?: number };
    modules?: { canvases?: string[]; devices?: string[] };
}

interface XsCanvasJson {
    id: string;
    title?: string;
    chunkLayout?: { chunkIndexes?: number[] };
}

interface XsVectorRef {
    vectorHash: string;
    bucketType: string;
    originalField: string;
}

interface XsBinding {
    baseProfileId?: string;
    displayIds?: string[];
    patchIds?: string[];
}

/** Parameter overrides layered on top of a profile, usually by a material preset. */
interface XsPatch {
    material?: { materialType?: string };
    overrides?: XcsParameters;
}

interface XsDeviceJson {
    extId?: string;
    extName?: string;
    power?: number | number[];
    processing?: Record<string, {
        activeMode?: string;
        modes?: Record<string, {
            data?: XcsModeData;
            bindings?: XsBinding[];
            patches?: Record<string, XsPatch>;
        }>;
    }>;
}

interface XsProfilesJson {
    profiles?: Record<string, { processingType?: string; values?: XcsParameters }>;
}

type XsProfiles = NonNullable<XsProfilesJson["profiles"]>;

/** True if the buffer starts with the ZIP magic ("PK") — i.e. a .xs project. */
export const isXsArchive = (buf: ArrayBuffer): boolean => {
    const b = new Uint8Array(buf);
    return b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
};

const readJson = <T>(files: Record<string, Uint8Array>, path: string): T | undefined => {
    const data = files[path];
    return data ? JSON.parse(strFromU8(data)) as T : undefined;
};

// Load every vectors/<bucket>/data-<n>.json into bucket -> hash -> value.
const loadVectorBuckets = (files: Record<string, Uint8Array>): Map<string, Record<string, unknown>> => {
    const buckets = new Map<string, Record<string, unknown>>();
    for (const path of Object.keys(files)) {
        const m = path.match(/^vectors\/([^/]+)\/data-\d+\.json$/);
        if (!m) continue;
        const oData = readJson<{ entries?: Record<string, unknown> }>(files, path);
        if (!oData?.entries) continue;
        const bucket = buckets.get(m[1]!) ?? {};
        Object.assign(bucket, oData.entries);
        buckets.set(m[1]!, bucket);
    }
    return buckets;
};

const IMAGE_MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml"
};

// btoa() needs a binary string; build it in chunks because spreading a whole
// multi-megabyte raster into String.fromCharCode overflows the argument limit.
const toBase64 = (data: Uint8Array): string => {
    const CHUNK = 0x8000,
        aParts: string[] = [];
    for (let i = 0; i < data.length; i += CHUNK) {
        aParts.push(String.fromCharCode(...data.subarray(i, i + CHUNK)));
    }
    return btoa(aParts.join(""));
};

// v1 .xcs embeds a BITMAP's raster inline as a base64 data URL; v2 extracts it
// to resources/<hash>.<ext> and leaves only a resourcePath on the display.
// Encode on demand and cache, so an unreferenced resource (e.g. the project
// cover thumbnail) or an image reused by several displays is never re-encoded.
const makeResourceLoader = (files: Record<string, Uint8Array>): (path: string) => string | undefined => {
    const cache = new Map<string, string | undefined>();
    return (sPath: string): string | undefined => {
        const sKey = sPath.replace(/^\.?\//, "");
        if (cache.has(sKey)) return cache.get(sKey);

        const data = files[sKey],
            sExt = sKey.split(".").pop()?.toLowerCase() ?? "",
            sUrl = data ? `data:${IMAGE_MIME[sExt] ?? "image/png"};base64,${toBase64(data)}` : undefined;

        cache.set(sKey, sUrl);
        return sUrl;
    };
};

// v2 deduplicates heavy fields (like a PATH's dPath) into the vectors store;
// the display carries { vectorRef: { vectorHash, bucketType, originalField } }
// instead. Inline the referenced value — and any raster referenced by
// resourcePath — back onto the display (and its nested TEXT charJSONs) so the
// v1 builders see every field where they expect it.
const hydrateDisplay = (
    oDisplay: XcsDisplay,
    buckets: Map<string, Record<string, unknown>>,
    fnResource: (path: string) => string | undefined
): void => {
    const ref = (oDisplay as unknown as { vectorRef?: XsVectorRef }).vectorRef;
    if (ref?.vectorHash && ref.originalField) {
        const value = buckets.get(ref.bucketType)?.[ref.vectorHash];
        if (value !== undefined) {
            (oDisplay as unknown as Record<string, unknown>)[ref.originalField] = value;
        }
    }

    if (!oDisplay.base64 && oDisplay.resourcePath) {
        const sUrl = fnResource(oDisplay.resourcePath);
        if (sUrl) oDisplay.base64 = sUrl;
    }

    oDisplay.charJSONs?.forEach(c => hydrateDisplay(c, buckets, fnResource));
};

const loadCanvas = (
    files: Record<string, Uint8Array>,
    sCanvasId: string,
    buckets: Map<string, Record<string, unknown>>,
    fnResource: (path: string) => string | undefined
): XcsCanvas | undefined => {
    const oMeta = readJson<XsCanvasJson>(files, `canvases/${sCanvasId}.json`);
    if (!oMeta) return undefined;

    const aChunks = oMeta.chunkLayout?.chunkIndexes ?? [0],
        aDisplays: XcsDisplay[] = [];

    aChunks.forEach(iChunk => {
        const oChunk = readJson<{ displays?: XcsDisplay[] }>(files, `canvases/${sCanvasId}/displays-${iChunk}.json`);
        oChunk?.displays?.forEach(oDisplay => {
            hydrateDisplay(oDisplay, buckets, fnResource);
            aDisplays.push(oDisplay);
        });
    });

    // v1 stores displays in stacking order; v2 keeps an explicit zOrder.
    aDisplays.sort((a, b) =>
        ((a as unknown as { zOrder?: number }).zOrder ?? 0) - ((b as unknown as { zOrder?: number }).zOrder ?? 0));

    return { id: sCanvasId, title: oMeta.title || "Canvas", displays: aDisplays };
};

// A binding's laser parameters are its profile's values with every referenced
// patch applied in order (last one wins) — the same layering Studio does when a
// material preset is dropped onto a profile. Rebuilt into the v1 nesting
// (data[processingType].parameter[materialType]) so meta.ts reads one shape.
const buildDisplayConfig = (
    oBinding: XsBinding,
    oProfiles: XsProfiles,
    oPatches: Record<string, XsPatch>
): XcsDeviceDisplayConfig => {
    const oProfile = oBinding.baseProfileId ? oProfiles[oBinding.baseProfileId] : undefined,
        sType = oProfile?.processingType;
    if (!sType) return {};

    const aPatches = (oBinding.patchIds ?? []).map(sId => oPatches[sId]).filter((p): p is XsPatch => !!p),
        oParams: XcsParameters = Object.assign({}, oProfile.values, ...aPatches.map(p => p.overrides)),
        sSet = aPatches[aPatches.length - 1]?.material?.materialType || "customize";

    return {
        processingType: sType,
        data: { [sType]: { materialType: sSet, parameter: { [sSet]: oParams } } }
    };
};

// Rebuild the v1 device map (canvasId -> displayId -> processingType + params)
// from the v2 bindings: each binding ties a profile (which owns the
// processingType) to a list of display ids.
const buildDeviceData = (
    oDevice: XsDeviceJson,
    oProfiles: XsProfiles
): XcsProject["device"] => {
    const aValue = Object.entries(oDevice.processing ?? {}).map(([sCanvasId, oProc]) => {
        const sMode = oProc.activeMode,
            oMode = (sMode && oProc.modes?.[sMode]) || {},
            aDisplays: [string, XcsDeviceDisplayConfig][] = [];

        (oMode.bindings ?? []).forEach(oBinding => {
            // One config object shared by every display of the binding — they
            // are bound to it precisely because they run the same settings.
            const oCfg = buildDisplayConfig(oBinding, oProfiles, oMode.patches ?? {});
            oBinding.displayIds?.forEach(sId => aDisplays.push([sId, oCfg]));
        });

        return [sCanvasId, {
            mode: sMode,
            data: sMode && oMode.data ? { [sMode]: oMode.data } : undefined,
            displays: { value: aDisplays }
        }] as [string, XcsDeviceCanvasEntry];
    });

    return { power: oDevice.power, data: { value: aValue } };
};

/** Parse a .xs (xTool Studio) archive into the v1 XcsProject shape. */
export const parseXs = (buf: ArrayBuffer): XcsProject => {
    const files = unzipSync(new Uint8Array(buf)),
        oProject = readJson<XsProjectJson>(files, "project.json");

    if (!oProject?.modules?.canvases?.length) {
        throw new Error("not an xs project");
    }

    const buckets = loadVectorBuckets(files),
        fnResource = makeResourceLoader(files),
        aCanvas = oProject.modules.canvases
            .map(sId => loadCanvas(files, sId, buckets, fnResource))
            .filter((c): c is XcsCanvas => !!c);

    if (!aCanvas.length) {
        throw new Error("no canvases found");
    }

    const sDeviceId = oProject.activeDeviceId || oProject.modules.devices?.[0],
        oDevice = sDeviceId ? readJson<XsDeviceJson>(files, `devices/device-${sDeviceId}.json`) : undefined;

    return {
        canvas: aCanvas,
        // v1 keeps these at the top level; v2 splits them over project.json and
        // the device file. Normalise here so meta.ts has a single source.
        extId: oDevice?.extId,
        extName: oDevice?.extName,
        version: oProject.versionInfo?.appVersion,
        ua: oProject.versionInfo?.ua,
        created: oProject.created,
        modify: oProject.modify ?? oProject.versionInfo?.savedAt,
        cover: oProject.cover ? fnResource(oProject.cover) : undefined,
        device: oDevice
            ? buildDeviceData(oDevice, readJson<XsProfilesJson>(files, "profiles.json")?.profiles ?? {})
            : undefined
    };
};
