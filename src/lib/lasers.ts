// ---------------------------------------------------------------------------
// Cross-machine settings conversion
//
// xTool stores power as a percentage of one specific module, so the numbers are
// meaningless on another machine: 60 % of a 40 W diode is 24 W of light, which a
// 10 W diode cannot reach at any speed. Converting therefore happens in optical
// watts, holding the energy delivered per millimetre — the quantity that
// actually burns the material — constant:
//
//     E = passes × (watt × power% / 100) / speed        [J/mm]
//
// Speed is kept wherever the target can supply the power, because it is the
// value most likely to have been chosen for the geometry (corner dwell,
// scorching, char). A target too weak for the source runs flat out and slows
// down instead, and only when that would sink below what a controller handles
// smoothly are passes added, with the speed raised to match.
//
// This is arithmetic, not a table of tested values — spot size, lens, air assist
// and the material batch all move the result. It gives the centre of a test
// grid, not a setting to run unattended.
// ---------------------------------------------------------------------------

export interface Laser {
    id: string;
    /** what the module *is* — wattage and type, and nothing else */
    label: string;
    /** optical output in watts */
    watt: number;
    /** nm: 455 blue diode, 1064 IR/fibre, 10600 CO₂ */
    wavelength: number;
    /**
     * Machines this module ships on.
     *
     * Only ever shown for the laser being converted *from*, where the question
     * is "which of these did my project come off?" and the model name is the
     * quickest way to answer it. Converting *to* is a choice about a machine you
     * already know, so there the wattage and the type are the whole story.
     */
    machines?: string;
}

/** The module named for a picker: generic, or with the machines that carry it. */
export const laserLabel = (o: Laser, bMachines = false): string =>
    bMachines && o.machines ? `${o.label} · ${o.machines}` : o.label;

/**
 * The modules a project is likely to have been made for, and the ones you might
 * be moving it to. The wattages are the optical output the manufacturer states.
 *
 * The machine names are a finding aid, not a spec — several models ship in more
 * than one configuration, and a module can be moved between bodies. The number
 * and the wavelength are what the conversion actually uses.
 */
export const LASERS: Laser[] = [
    { id: "diode-2", label: "Diode 2 W · 455 nm", watt: 2, wavelength: 455 },
    { id: "diode-5", label: "Diode 5 W · 455 nm", watt: 5, wavelength: 455, machines: "D1, M1" },
    { id: "diode-10", label: "Diode 10 W · 455 nm", watt: 10, wavelength: 455, machines: "D1, M1, F1, S1" },
    { id: "diode-20", label: "Diode 20 W · 455 nm", watt: 20, wavelength: 455, machines: "D1 Pro, S1, F1 Ultra" },
    { id: "diode-40", label: "Diode 40 W · 455 nm", watt: 40, wavelength: 455, machines: "S1" },
    { id: "ir-2", label: "IR 2 W · 1064 nm", watt: 2, wavelength: 1064, machines: "F1, S1 module" },
    { id: "ir-5", label: "IR 5 W · 1064 nm", watt: 5, wavelength: 1064 },
    { id: "ir-20", label: "Fibre 20 W · 1064 nm", watt: 20, wavelength: 1064, machines: "F1 Ultra" },
    { id: "ir-60", label: "Fibre 60 W · 1064 nm", watt: 60, wavelength: 1064, machines: "F2 Ultra" },
    { id: "co2-40", label: "CO₂ 40 W · 10600 nm", watt: 40, wavelength: 10600 },
    { id: "co2-55", label: "CO₂ 55 W · 10600 nm", watt: 55, wavelength: 10600, machines: "P2, P2S, P3" },
    { id: "co2-60", label: "CO₂ 60 W · 10600 nm", watt: 60, wavelength: 10600 }
];

export const getLaser = (sId: string): Laser | undefined => LASERS.find(o => o.id === sId);

const WAVELENGTHS: Record<string, number> = {
    blue: 455,
    red: 638,
    ir: 1064,
    infrared: 1064,
    co2: 10600
};

/** Catalogue entry closest to the module a project was saved for ("" if unknown). */
export const detectLaser = (iWatt?: number, sKind?: string): string => {
    if (!iWatt) return "";

    const iWave = (sKind && WAVELENGTHS[sKind.toLowerCase()]) || 455,
        aPool = LASERS.filter(o => o.wavelength === iWave);

    return (aPool.length ? aPool : LASERS)
        .reduce((oBest, o) => (Math.abs(o.watt - iWatt) < Math.abs(oBest.watt - iWatt) ? o : oBest)).id;
};

export interface ConvertedSetting {
    /** % */
    power: number;
    /** mm/s */
    speed: number;
    passes: number;
    /** the target cannot match the source's power and runs at 100 % */
    flatOut: boolean;
}

/** Below this most controllers stutter and the material chars instead of cutting. */
const MIN_SPEED = 2;
const MAX_PASSES = 8;

export const convertSetting = (
    o: { power?: number; speed?: number; passes?: number },
    oSource: Laser,
    oTarget: Laser
): ConvertedSetting | undefined => {
    if (!o.power || !o.speed) return undefined;

    const iPasses = o.passes || 1,
        fOptical = (oSource.watt * o.power) / 100,   // watts of light the source emitted
        fNeeded = (fOptical / oTarget.watt) * 100;   // % the target would have to run at

    if (fNeeded <= 100) {
        return { power: Math.max(1, Math.round(fNeeded)), speed: o.speed, passes: iPasses, flatOut: false };
    }

    const fEnergy = (iPasses * fOptical) / o.speed;  // J/mm to reproduce
    let iOut = iPasses,
        fSpeed = (iOut * oTarget.watt) / fEnergy;

    // Each added pass delivers the same energy over a proportionally faster run.
    while (fSpeed < MIN_SPEED && iOut < MAX_PASSES) {
        iOut++;
        fSpeed = (iOut * oTarget.watt) / fEnergy;
    }

    return {
        power: 100,
        speed: +fSpeed.toFixed(fSpeed < 10 ? 1 : 0),
        passes: iOut,
        flatOut: true
    };
};
