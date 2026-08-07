import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// The vocabulary the shell and the tools share.
//
// The shell knows how to lay out a workspace, show a drawing, list numbers in a
// status bar and write a file. It knows nothing about contours, stamps or
// thresholds. Everything a tool wants to put into the chrome it describes with
// the handful of types below — which is what stops the chrome from growing a
// special case per tool, the way the old per-tool headers had.
// ---------------------------------------------------------------------------

/** One number about the result, shown in the status bar. */
export interface Stat {
    label: string;
    value: string;
    /** the long form, for the tooltip */
    hint?: string;
}

/** A colour in the drawing, and what it means. */
export interface LegendItem {
    color: string;
    label: string;
    /** drawn as a ring rather than a dot — for white on a white stage */
    outlined?: boolean;
}

/**
 * One entry of the single Export menu.
 *
 * Everything a tool can write to disk is one of these, including the things
 * that used to be their own buttons in a header (the stamp's parts sheet, the
 * contour's outline-with-design, the converter's zip). That is the whole point:
 * "where do I export?" has exactly one answer everywhere in the kit.
 */
export interface ExportItem {
    id: string;
    /** short name, as the menu row's title */
    label: string;
    /** the badge beside the title: "default", "vector", ".fds" */
    note?: string;
    /** one line on what this format does with the design */
    desc: string;
    /** the file that will be written */
    filename: string;
    /** built only when picked — an .fds is a zip and an SVG can be large */
    blob: () => Blob | Promise<Blob>;
    /** GA event name, as configured in Google Analytics */
    event: string;
    /** why this cannot be used right now; undefined = it can */
    blocked?: string;
    /**
     * "design" is the tool's own result in some format — these are what the
     * split button's main half cycles between. "extra" is a companion file: the
     * stamp's parts sheet, the outline with the design behind it, a zip of every
     * canvas. They sit in their own group so the format list stays a format list.
     */
    group?: "design" | "extra";
}

/** A page of the open file — an .xcs project holds several. */
export interface DocTab {
    id: string;
    label: string;
}

/** What the stage is drawing, and what clicking it means. */
export interface StageSpec {
    /** SVG markup at true size in millimetres */
    svg: string;
    /** what makes this a different drawing, deserving a refit of the view */
    fitKey: string;
    /** clicking picks something — the point arrives in millimetres */
    onPick?: (p: { x: number; y: number }) => void;
    /** the pointer is a picker rather than a hand */
    picking?: boolean;
    /** a rebuild is in flight */
    pending?: boolean;
    /**
     * One thing on the drawing you can pick up and move.
     *
     * Its own element over the stage rather than a hit test inside it: a
     * separate DOM node keeps the pan listeners from ever seeing the drag, and
     * it gives the thing a visible grip instead of a place you have to know
     * about. The position is in millimetres; the stage keeps it under the
     * cursor as the view moves.
     */
    handle?: {
        x: number;
        y: number;
        label: string;
        onMove: (p: { x: number; y: number }) => void;
    };
}

/** Handing the current design to another tool. */
export interface SendToSpec {
    name: string;
    svg: () => string;
    disabled?: boolean;
}

/** A block in the left sidebar. */
export interface SidebarBlock {
    id: string;
    title: string;
    icon?: ReactNode;
    /** collapsed until opened; the default is open */
    defaultOpen?: boolean;
    children: ReactNode;
    /** a count or a short state, shown on the header row */
    badge?: ReactNode;
}
