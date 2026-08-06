import { getDeviceEntry } from "./convert";
import { getOperationFor } from "./dxf";
import type { XcsProject, XcsCanvas, XcsDeviceDisplayConfig, XcsParameters } from "./convert";
import type { Operation } from "./dxf";

// ---------------------------------------------------------------------------
// Project metadata
//
// Both project formats carry more than geometry: the machine and laser module
// they were set up for, the material slot with its thickness and focus, and the
// power/speed/passes behind every operation. None of that survives into a DXF,
// SVG or .fds file — those are pure geometry — so it is surfaced in the UI
// instead: after importing the converted file, this is what you re-enter as cut
// settings in LightBurn or Falcon Design Space.
//
// The material itself is stored only as a numeric id from xTool's online
// catalogue. The readable name comes from device.materialList, which older app
// versions embed and current ones leave empty, so the name is shown when it is
// there and the bare id otherwise.
// ---------------------------------------------------------------------------

export interface ProjectMeta {
    /** machine model, e.g. "S1" */
    device?: string;
    /** laser module wattage, e.g. "40 W" */
    power?: string;
    /** app that saved the project, e.g. "xTool Studio 1.7.24" */
    app?: string;
    created?: string;
    modified?: string;
    /** project thumbnail as a data URL */
    cover?: string;
    /** wattage of the module the settings were tuned for — seeds the conversion */
    sourceWatt?: number;
    /** light source of that module: "blue", "ir", … */
    sourceKind?: string;
    /** true when sourceWatt is the machine model's stock module, not a stored value */
    sourceAssumed?: boolean;
}

/** One row of the settings table: an operation and the parameters it runs at. */
export interface OperationSetting {
    operation: Operation;
    /** how many shapes on the canvas share these settings */
    shapes: number;
    /** true when the values come from an xTool material preset, not manual input */
    preset: boolean;
    /** % */
    power?: number;
    /** mm/s */
    speed?: number;
    passes?: number;
    density?: number;
    /** extra switches worth carrying over, e.g. "overcut 0.5 mm" */
    notes: string[];
}

export interface CanvasMeta {
    material?: string;
    thickness?: string;
    focalLength?: string;
    airAssist?: string;
    purifier?: string;
    precautions: string[];
    settings: OperationSetting[];
}

const PRECAUTIONS: Record<string, string> = {
    FLAMMABLE: "Flammable material",
    TURN_ON_AIR_PUMP: "Turn on air assist",
    ODOR_PROTECTION: "Odour protection",
    PEEL_FILM_BEFORE: "Peel the film off first",
    CLEAN_AFTER: "Clean up afterwards",
    WEAR_GLOVES: "Wear gloves",
    KEEP_VENTILATED: "Keep the room ventilated"
};

// Unknown codes still read sensibly as sentence-cased words.
const humanise = (sCode: string): string =>
    PRECAUTIONS[sCode] ??
    sCode.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase());

const mm = (n?: number | null): string | undefined =>
    typeof n === "number" && n > 0 ? `${+n.toFixed(2)} mm` : undefined;

const formatDate = (ms?: number): string | undefined =>
    ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : undefined;

// The user agent names the app ("xToolStudio/1.7.24"); v2 keeps it in
// versionInfo.ua, which xs.ts copies over, so one match covers both formats.
const APPS: [RegExp, string][] = [
    [/xToolStudio\/([\d.]+)/, "xTool Studio"],
    [/xToolCreativeSpace\/([\d.]+)/, "xTool Creative Space"]
];

const getApp = (oJSON: XcsProject): string | undefined => {
    for (const [rx, sName] of APPS) {
        const aMatch = oJSON.ua?.match(rx);
        if (aMatch) return `${sName} ${aMatch[1]}`;
    }
    // Very old .xcs files carry no user agent — the bare version is all there is.
    return oJSON.version ? `xTool ${oJSON.version}` : undefined;
};

const getPower = (oJSON: XcsProject): string | undefined => {
    const power = oJSON.device?.power,
        aWatt = (Array.isArray(power) ? power : [power]).filter((n): n is number => !!n);
    // Several entries mean several modules (e.g. blue + infrared).
    return aWatt.length ? `${aWatt.join(" / ")} W` : undefined;
};

const getMaterial = (oJSON: XcsProject, iId?: number): string | undefined => {
    if (!iId) return undefined; // 0 / absent: no material selected
    const oName = oJSON.device?.materialList?.find(m => m.id === iId)?.name,
        sName = typeof oName === "string" ? oName : oName?.en ?? Object.values(oName ?? {})[0];
    return sName || `Material #${iId}`;
};

// A display carries a parameter block per processing type; only the active one
// applies, and within it the set named by materialType (an xTool preset under
// "official", hand-tuned values under "customize").
const getParameters = (oCfg: XcsDeviceDisplayConfig): { params: XcsParameters; preset: boolean } | undefined => {
    const oProc = oCfg.processingType ? oCfg.data?.[oCfg.processingType] : undefined;
    if (!oProc) return undefined;

    const sSet = oProc.materialType || oProc.planType,
        oParams = (sSet && oProc.parameter?.[sSet]) || oProc.parameter?.customize;

    return oParams ? { params: oParams, preset: sSet === "official" } : undefined;
};

// Wattage of the machines' stock laser module, keyed by the extId a project
// stores. Only a last resort: older files (and any project saved before a module
// was ever attached) leave device.power at 0, and then the machine model is the
// only clue left. Models sold in several wattages list the one they most
// commonly ship as — flagged as assumed in the UI so it gets checked.
const MACHINES: Record<string, { watt: number; kind: string }> = {
    D1: { watt: 10, kind: "blue" },
    D1Pro: { watt: 20, kind: "blue" },
    M1: { watt: 10, kind: "blue" },
    M1Ultra: { watt: 10, kind: "blue" },
    M2: { watt: 10, kind: "blue" },
    M2Ultra: { watt: 10, kind: "blue" },
    S1: { watt: 20, kind: "blue" },
    F1: { watt: 10, kind: "blue" },
    F1Ultra: { watt: 20, kind: "blue" },
    P2: { watt: 55, kind: "co2" },
    P2S: { watt: 55, kind: "co2" },
    P3: { watt: 55, kind: "co2" }
};

export interface LaserSource {
    watt?: number;
    kind?: string;
    /** the wattage comes from the machine model, not from the file itself */
    assumed?: boolean;
}

// Which laser module the stored percentages refer to. Newer files name it
// outright ("laser_blue_10W"); older ones only say which light source was
// active, leaving the device wattage — and finally the machine model — as the
// best available figure.
const detectSource = (oJSON: XcsProject): LaserSource => {
    let sKind: string | undefined;

    for (const [, oEntry] of oJSON.device?.data?.value ?? []) {
        for (const [, oCfg] of oEntry.displays?.value ?? []) {
            const oParams = getParameters(oCfg)?.params;
            if (!oParams) continue;
            sKind ??= oParams.processingLightSource;

            const aMatch = oParams.laser?.match(/^laser_([a-z]+)_([\d.]+)w$/i);
            if (aMatch) return { watt: parseFloat(aMatch[2]!), kind: aMatch[1] };
        }
    }

    const power = oJSON.device?.power,
        aWatt = (Array.isArray(power) ? power : [power]).filter((n): n is number => !!n);

    if (aWatt.length) {
        // Several entries mean several modules: the IR one is always the small
        // number, every diode module the larger.
        return { watt: sKind === "ir" ? Math.min(...aWatt) : Math.max(...aWatt), kind: sKind };
    }

    const oMachine = MACHINES[(oJSON.extId || oJSON.extName || "").replace(/[\s-]/g, "")];
    return oMachine
        ? { watt: oMachine.watt, kind: sKind ?? oMachine.kind, assumed: true }
        : { kind: sKind };
};

export const getProjectMeta = (oJSON: XcsProject): ProjectMeta => {
    const oSource = detectSource(oJSON);
    return {
        device: oJSON.extName || oJSON.extId,
        power: getPower(oJSON),
        app: getApp(oJSON),
        created: formatDate(oJSON.created),
        modified: formatDate(oJSON.modify),
        // v1 stores the cover inline, xs.ts resolves the v2 path to a data URL —
        // ignore anything else so a stale path never ends up in an <img src>.
        cover: oJSON.cover?.startsWith("data:") ? oJSON.cover : undefined,
        sourceWatt: oSource.watt,
        sourceKind: oSource.kind,
        sourceAssumed: oSource.assumed
    };
};

const getNotes = (o: XcsParameters): string[] => {
    const a: string[] = [];
    if (o.enableOverCut && o.overCutDistance) a.push(`overcut ${o.overCutDistance} mm`);
    if (o.enableKerf && o.kerfDistance) a.push(`kerf ${o.kerfDistance} mm`);
    if (o.bitmapMode) a.push(`dithering ${o.bitmapMode}`);
    return a;
};

export const getCanvasMeta = (oJSON: XcsProject, oCanvas: XcsCanvas): CanvasMeta => {
    const oEntry = getDeviceEntry(oJSON, oCanvas.id),
        oMode = (oEntry?.mode && oEntry.data?.[oEntry.mode]) || {},
        // Both formats store settings per shape while the UI (and every laser
        // tool) thinks in layers, so collapse shapes that share an operation
        // *and* its parameters into one row.
        mSettings = new Map<string, OperationSetting>();

    (oEntry?.displays?.value ?? []).forEach(([, oCfg]) => {
        const oResolved = getParameters(oCfg);
        if (!oResolved) return;

        const { power, speed, repeat, density } = oResolved.params,
            // Keyed on the numbers only: a preset and a hand-tuned layer that end
            // up identical are one row, otherwise the table shows the same values
            // twice for no visible reason.
            sKey = [oCfg.processingType, power, speed, repeat, density].join("|"),
            oRow = mSettings.get(sKey);

        if (oRow) {
            oRow.shapes++;
            oRow.preset ||= oResolved.preset;
            return;
        }
        mSettings.set(sKey, {
            operation: getOperationFor(oCfg.processingType),
            shapes: 1,
            preset: oResolved.preset,
            power,
            speed,
            passes: repeat,
            density,
            notes: getNotes(oResolved.params)
        });
    });

    // Machines take either the older geared purifier or the V3 (percentage);
    // xcsUsed says which fields this project drives, so the other stays hidden.
    const bV3 = oMode.xcsUsed?.includes("purifierV3Gear") ?? false;

    return {
        material: getMaterial(oJSON, oMode.material),
        thickness: mm(oMode.thickness),
        focalLength: mm(oMode.focalLength),
        airAssist: oMode.fanGear ? `Gear ${oMode.fanGear}` : undefined,
        purifier: bV3
            ? (oMode.purifierV3Gear ? `${oMode.purifierV3Gear} %` : undefined)
            : (oMode.purifierGear ? `Gear ${oMode.purifierGear}` : undefined),
        precautions: (oMode.precautionCodes ?? []).map(humanise),
        settings: [...mSettings.values()].sort((a, b) => b.shapes - a.shapes)
    };
};
