import { BookOpen, CornerDownRight, File, Files, History, LayoutTemplate, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/cn";
import { getTool } from "../lib/tools";
import { PanelSection } from "./PanelSection";
import type { DocTab, SidebarBlock } from "./types";
import type { HistoryEntry } from "./hooks/useHistoryParams";

// ---------------------------------------------------------------------------
// The left panel: what you are working *on*, never how it is set up.
//
// The split is the whole point of the redesign. Everything on the left answers
// "which thing?" — which file, which canvas, which starting point, which step of
// my own history. Everything on the right answers "how?". Once that line is
// drawn, the question the old UI provoked twenty times a session ("is this a
// setting or a place?") stops being askable.
//
// The canvas list is the clearest win: an .xcs project's canvases used to be
// tabs floating above the preview, competing with the download buttons beside
// them. They are pages of a document, so they live where a document's pages live.
//
// Note what is *not* here: anything that produces a file. Export, the companion
// downloads and Send to are all outputs of the document, and outputs belong in
// the toolbar with the other document-level actions.
// ---------------------------------------------------------------------------

export interface SidebarProps {
    open: boolean;
    /** the open file, empty when there is none */
    name: string;
    /** id of the tool that handed this design over, if it did not come off disk */
    from: string | null;
    tabs: DocTab[];
    tab: number;
    onTab: (i: number) => void;
    /** what a page of this document is called: "Canvas", "Design" */
    tabNoun: string;
    onReplace: () => void;
    onClose: () => void;
    /**
     * False for a tool built out of numbers rather than a file. The whole
     * Project block goes with it: there is no file to name, none to replace and
     * none to close, and a generator's "document" is already named in the
     * toolbar and measured in the status bar.
     */
    openable?: boolean;
    /** past, present and future as one list, newest last */
    history: HistoryEntry[];
    historyIndex: number;
    onHistoryJump: (index: number) => void;
    /** tool-supplied blocks: presets, source-file facts */
    blocks?: SidebarBlock[];
    /** opens the "how this tool works" overlay */
    onAbout: () => void;
}

export function Sidebar(props: SidebarProps) {
    const bOpen = !!props.name;

    return (
        <aside
            aria-label="Project"
            data-testid="sidebar"
            className={cn(
                "flex w-sidebar shrink-0 flex-col overflow-hidden border-r border-line bg-panel",
                // Below xl the panel floats over the stage instead of squeezing it:
                // 224 px taken off a 1280 px screen is 224 px the drawing needed.
                "max-xl:absolute max-xl:inset-y-0 max-xl:left-0 max-xl:z-40 max-xl:shadow-2xl max-xl:shadow-black/60",
                !props.open && "hidden"
            )}
        >
            <div className="scroll-slim flex-1 overflow-y-auto overscroll-contain">
                {/* ── the file ───────────────────────────────────────────── */}
                {props.openable !== false && (
                <PanelSection id="source" title="Project" icon={<File className="size-3" />}>
                    {bOpen ? (
                        <div className="space-y-2">
                            <p className="flex items-start gap-1.5 text-xs">
                                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />
                                <span className="min-w-0 flex-1 break-words text-foreground">{props.name}</span>
                            </p>
                            {props.from && (
                                <p className="flex items-center gap-1 pl-3 text-[11px] text-subtle-foreground">
                                    <CornerDownRight className="size-3 shrink-0" />
                                    from {getTool(props.from).short}
                                </p>
                            )}
                            <div className="flex gap-1">
                                <Button variant="outline" size="sm" className="flex-1" onClick={props.onReplace}>
                                    Replace
                                </Button>
                                <Button variant="ghost" size="icon-sm" aria-label="Close file" onClick={props.onClose}>
                                    <X className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-xs leading-relaxed text-subtle-foreground">
                            Nothing open. Drop a file on the canvas, or use Open in the toolbar.
                        </p>
                    )}
                </PanelSection>
                )}

                {/* ── the pages of it ────────────────────────────────────── */}
                {props.tabs.length > 1 && (
                    <PanelSection
                        id="canvases"
                        title={`${props.tabNoun}s`}
                        icon={<Files className="size-3" />}
                        badge={<Badge>{props.tabs.length}</Badge>}
                    >
                        <ul className="space-y-0.5" role="tablist" aria-label={`${props.tabNoun}s`}>
                            {props.tabs.map((o, i) => (
                                <li key={o.id}>
                                    <button
                                        role="tab"
                                        aria-selected={i === props.tab}
                                        onClick={() => props.onTab(i)}
                                        className={cn(
                                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                            i === props.tab
                                                ? "bg-accent/12 text-accent"
                                                : "text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                                        )}
                                    >
                                        <span className="w-4 shrink-0 text-right font-mono text-[10px] opacity-60">{i + 1}</span>
                                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </PanelSection>
                )}

                {/* ── whatever this tool wants here: presets, source facts ─ */}
                {props.blocks?.map(o => (
                    <PanelSection
                        key={o.id}
                        id={o.id}
                        title={o.title}
                        icon={o.icon ?? <LayoutTemplate className="size-3" />}
                        badge={o.badge}
                        defaultOpen={o.defaultOpen ?? true}
                    >
                        {o.children}
                    </PanelSection>
                ))}

                {/* ── every change you made, in order ────────────────────── */}
                <PanelSection
                    id="history"
                    title="History"
                    icon={<History className="size-3" />}
                    defaultOpen={false}
                    badge={props.history.length > 1 ? <Badge>{props.history.length}</Badge> : undefined}
                >
                    {props.history.length > 1 ? (
                        <ol className="space-y-0.5">
                            {props.history.map((o, i) => (
                                <li key={i}>
                                    <button
                                        onClick={() => props.onHistoryJump(i)}
                                        aria-current={i === props.historyIndex ? "step" : undefined}
                                        className={cn(
                                            "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                                            i === props.historyIndex
                                                ? "bg-panel-2 text-foreground"
                                                : i > props.historyIndex
                                                    ? "text-subtle-foreground hover:bg-panel-2"
                                                    : "text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "size-1.5 shrink-0 rounded-full",
                                                i === props.historyIndex ? "bg-accent" : "bg-line-strong"
                                            )}
                                            aria-hidden="true"
                                        />
                                        <span className="min-w-0 flex-1 truncate">{o.label ?? "Opened"}</span>
                                    </button>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className="text-[11px] leading-relaxed text-subtle-foreground">
                            Nothing changed yet. Every setting you touch lands here, and clicking a step goes back to it.
                        </p>
                    )}
                </PanelSection>
            </div>

            {/* Pinned to the foot of the panel rather than scrolling with it:
                "I do not understand this tool" is the one thing that has to be
                reachable without having found anything else first. */}
            <button
                onClick={props.onAbout}
                data-testid="about-button"
                className={cn(
                    "flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5 text-left",
                    "text-xs text-muted-foreground transition-colors hover:bg-panel-2 hover:text-foreground"
                )}
            >
                <BookOpen className="size-3.5 shrink-0 text-subtle-foreground" />
                <span className="flex-1">How this tool works</span>
            </button>
        </aside>
    );
}
