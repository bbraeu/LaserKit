import type { ReactNode } from "react";
import { Layers3 } from "lucide-react";
import { PanelSection } from "./PanelSection";
import { NumberField, Field, SegmentedField } from "./fields";

// ---------------------------------------------------------------------------
// What the piece is cut from.
//
// This is only offered where it actually changes something. In the stamp
// creator it does: the handle is a stack of discs one material thickness each
// and the cap's cavity is two, so "3 mm plywood" and "5 mm acrylic" are
// different stamps to hold — and the panel says so, in millimetres, before
// anything is cut. A material picker on a tool where nothing downstream reads it
// would be a control that lies, so the other tools do not have one.
// ---------------------------------------------------------------------------

export type MaterialId = "wood" | "acrylic" | "rubber";

export const MATERIALS = [
    { id: "wood" as const, label: "Wood" },
    { id: "acrylic" as const, label: "Acrylic" },
    { id: "rubber" as const, label: "Rubber" }
];

/** How thick the stock usually is, so picking a material sets a sane default. */
export const TYPICAL_THICKNESS: Record<MaterialId, number> = { wood: 3, acrylic: 3, rubber: 2.3 };

/** Fixed by lib/stamp.ts — the numbers the parts sheet is actually built from. */
const HANDLE_DISCS = 5;
const CAP_RINGS = 2;

export interface MaterialNotes {
    discs: number;
    capRings: number;
    /** height of the glued handle stack, mm */
    handleHeight: number;
    /** depth of the cap's cavity, mm */
    capDepth: number;
}

/** What a thickness makes of the parts sheet — the only thing it changes. */
export const materialNotes = (thickness: number): MaterialNotes => ({
    discs: HANDLE_DISCS,
    capRings: CAP_RINGS,
    handleHeight: HANDLE_DISCS * thickness,
    capDepth: CAP_RINGS * thickness
});

export interface MaterialSectionProps {
    material: MaterialId;
    thickness: number;
    onMaterial: (v: MaterialId) => void;
    onThickness: (n: number) => void;
    /** what follows from the thickness, in the tool's own words */
    notes?: string[];
    footer?: ReactNode;
}

export function MaterialSection(props: MaterialSectionProps) {
    return (
        <PanelSection id="material" title="Material" icon={<Layers3 className="size-3" />}>
            <SegmentedField
                value={props.material}
                choices={MATERIALS}
                onChange={v => {
                    props.onMaterial(v);
                    props.onThickness(TYPICAL_THICKNESS[v]);
                }}
            />
            <Field
                label="Thickness"
                hint="The sheet the parts are cut from. It does not change the geometry that is cut — it is what the stack heights below are worked out from."
                control={
                    <NumberField
                        label="Material thickness in millimetres"
                        value={props.thickness}
                        min={0.5}
                        max={25}
                        onChange={props.onThickness}
                    />
                }
            />
            {props.notes && props.notes.length > 0 && (
                <ul className="mt-1 space-y-1">
                    {props.notes.map(s => (
                        <li key={s} className="text-[11px] leading-snug text-subtle-foreground">{s}</li>
                    ))}
                </ul>
            )}
            {props.footer && (
                <p className="mt-2 text-[11px] leading-relaxed text-subtle-foreground">{props.footer}</p>
            )}
        </PanelSection>
    );
}
