import { getTool } from "./tools";

// ---------------------------------------------------------------------------
// Handing a design from one tool to the next.
//
// The tools chain in real work: trace a logo into vectors, then make a stamp of
// it; convert a project, then trace the cut line around one of its canvases.
// Doing that through the file system means a download, a folder, and a drag back
// in — for a file that never had any business leaving the browser.
//
// So the sending tool puts what it just made into sessionStorage and navigates;
// the receiving tool picks it up on load and feeds it to the very same reader a
// dropped file goes through. The payload is always an SVG in millimetres, which
// is what every tool that takes a design already reads, so nothing about the
// receiving end has to know where the design came from.
//
// sessionStorage rather than a query string or IndexedDB: the payload is far too
// big for a URL, it belongs to this tab only, and it should not outlive it.
// ---------------------------------------------------------------------------

const KEY = "laserkit:handoff";

export interface Handoff {
    /** the sending tool's own output: an SVG at true size in millimetres */
    svg: string;
    /** file name stem, so what the receiving tool writes keeps the trail */
    name: string;
    /** id of the tool it came from, for the line the receiver shows */
    from: string;
}

/**
 * Tools that take a design, and can therefore be handed one.
 *
 * Nesting is last because it is what you do once the design is finished: make
 * the keychain, then fill a sheet with it. Sending *from* it would hand the
 * next tool a sheet of two hundred copies, which is why nothing does.
 */
export const HANDOFF_TARGETS = ["contour", "stamp", "nest"];

/** The tools a design can be sent to from here. */
export const handoffTargets = (from: string): string[] =>
    HANDOFF_TARGETS.filter(id => id !== from).map(id => getTool(id).id);

/** Stash the design and go to the tool that is to work on it next. */
export const sendToTool = (to: string, o: Handoff): void => {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(o));
    } catch {
        // Private mode, a full quota, cookies off: not worth failing the click
        // over — the target tool simply opens with its drop zone empty.
    }
    location.href = `${import.meta.env.BASE_URL}${getTool(to).slug}`;
};

/**
 * The design handed over to this tool, if there is one. Consumed on read, so a
 * reload starts from the drop zone rather than silently re-importing.
 */
export const takeHandoff = (): Handoff | null => {
    try {
        const s = sessionStorage.getItem(KEY);
        if (!s) return null;
        sessionStorage.removeItem(KEY);
        const o: unknown = JSON.parse(s);
        return o && typeof o === "object" && typeof (o as Handoff).svg === "string"
            ? (o as Handoff)
            : null;
    } catch {
        return null;
    }
};

/** The handed-over design as the File the tools' own readers expect. */
export const handoffFile = (o: Handoff): File =>
    new File([o.svg], `${o.name || "design"}.svg`, { type: "image/svg+xml" });
