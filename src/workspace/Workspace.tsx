import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../components/ui/button";
import { TooltipProvider } from "../components/ui/tooltip";
import { cn } from "../lib/cn";
import { getTool } from "../lib/tools";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";
import { Stage } from "./Stage";
import type { StageApi, StageProps } from "./Stage";
import { Statusbar } from "./Statusbar";
import { Toolbar } from "./Toolbar";
import { useWorkspaceChrome } from "./hooks/useWorkspaceChrome";
import type { HistoryControls } from "./hooks/useHistoryParams";
import type { DocTab, ExportItem, LegendItem, SendToSpec, SidebarBlock, StageSpec, Stat } from "./types";

// ---------------------------------------------------------------------------
// The frame every tool runs inside.
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ Toolbar — global actions only                            │
//   ├─────────┬────────────────────────────────────┬───────────┤
//   │ Sidebar │              Stage                 │ Inspector │
//   │  what   │        the drawing, ~70 %          │    how    │
//   ├─────────┴────────────────────────────────────┴───────────┤
//   │ Statusbar — what the tool worked out                     │
//   └──────────────────────────────────────────────────────────┘
//
// A tool supplies content for the three regions and gets the rest for free:
// undo, keyboard shortcuts, panels that remember whether they were open, drop
// anywhere, one export menu, and a stage with rulers.
//
// The reason this is a props object rather than four children slots is that the
// chrome needs to *know* things — whether anything is open, whether an export is
// possible, how many pages the document has — and a slot cannot be interrogated.
// Every field below is something the toolbar, the sidebar or the status bar has
// to reason about.
// ---------------------------------------------------------------------------

export interface WorkspaceProps {
    toolId: string;
    /** what the inspector calls the thing it is describing: "Stamp", "Cut line" */
    subject: string;
    subtitle?: string;

    /** the open file */
    documentName: string;
    from: string | null;
    tabs: DocTab[];
    tab: number;
    onTab: (i: number) => void;
    tabNoun?: string;

    empty: boolean;
    /**
     * Whether the *inspector* has nothing to describe. Defaults to `empty`,
     * which is right for a tool that opens a file — but the text generator has
     * no file, and its panel is the only way to put something on the stage. An
     * inspector that empties itself would lock the tool.
     */
    inspectorEmpty?: boolean;
    /**
     * Whether this tool takes a file at all. The box generator does not: it
     * makes its drawing out of numbers. An Open button that opens nothing and a
     * "Drop to open" overlay over a stage that accepts nothing are both
     * controls that lie, so they are left out rather than disabled.
     */
    openable?: boolean;
    busy: boolean;
    error: string | null;
    onOpenFile: (file: File) => void;
    onClose: () => void;

    stage: StageSpec;
    /** tool-specific view aids, beside the grid and ruler toggles */
    stageToggles?: StageProps["extraToggles"];
    legend?: LegendItem[];
    stats: Stat[];
    warnings: string[];

    /** undo, redo, reset and the step list — not the settings themselves */
    params: HistoryControls;

    exports: ExportItem[];
    sendTo?: SendToSpec;
    sidebarBlocks?: SidebarBlock[];
    /** the right panel's body */
    children: ReactNode;
    /**
     * Wide things that fit in neither side panel — the converter's parameter
     * table, the stamp's parts sheet. Each gets a button in the status bar and
     * opens as a tab under the stage, where there is room for a table or a
     * second drawing without taking width off the one you are working on.
     */
    bottomPanels?: { id: string; title: string; defaultOpen?: boolean; children: ReactNode }[];
    emptyTitle?: string;
    emptySub?: string;
    busyTitle?: string;
    busySub?: string;
}

export function Workspace(props: WorkspaceProps) {
    const oTool = getTool(props.toolId);
    const base = import.meta.env.BASE_URL;

    const chrome = useWorkspaceChrome();
    const [exportFormat, setExportFormat] = useState("");
    // null before anything has been decided, so a panel that wants to be open on
    // arrival can be; "" once the user has closed one, because that is a decision
    // and the next render must not undo it.
    const [bottomTab, setBottomTab] = useState<string | null>(null);
    const wantOpen = props.bottomPanels?.find(o => o.defaultOpen)?.id;
    useEffect(() => {
        if (wantOpen) setBottomTab(cur => (cur === null ? wantOpen : cur));
    }, [wantOpen]);

    const stageApi = useRef<StageApi | null>(null);
    const openInputRef = useRef<HTMLInputElement>(null);
    const readout = {
        zoom: useRef<HTMLSpanElement>(null),
        cursor: useRef<HTMLSpanElement>(null)
    };

    // Keyboard: the five shortcuts a design app is expected to have. Bound on the
    // document rather than on the workspace, because the focus is usually inside
    // a panel and an undo has to work from there too — but never while a text
    // field has it, or Ctrl+Z would fight the browser's own field-level undo.
    const { undo, redo } = props.params;
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const el = e.target as HTMLElement | null,
                bTyping = !!el?.closest("input,textarea,[contenteditable=true]");
            const mod = e.ctrlKey || e.metaKey;

            if (mod && e.key.toLowerCase() === "z" && !bTyping) {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
                return;
            }
            if (mod && e.key.toLowerCase() === "y" && !bTyping) {
                e.preventDefault();
                redo();
                return;
            }
            if (mod && e.key.toLowerCase() === "o") {
                e.preventDefault();
                openInputRef.current?.click();
                return;
            }
            if (bTyping) return;
            if (e.key === "0") { e.preventDefault(); stageApi.current?.resetView(); }
            else if (e.key === "+" || e.key === "=") { e.preventDefault(); stageApi.current?.zoomBy(1.4); }
            else if (e.key === "-") { e.preventDefault(); stageApi.current?.zoomBy(1 / 1.4); }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [undo, redo]);

    // The explainer is server-rendered Astro markup in a <dialog> outside this
    // island, so the island asks for it by event rather than reaching for an
    // element it has no business knowing about.
    const openAbout = useCallback(() => {
        document.dispatchEvent(new CustomEvent("laserkit:about"));
    }, []);

    const bExportable = !props.empty && props.exports.some(o => !o.blocked),
        openPanel = props.bottomPanels?.find(o => o.id === bottomTab);

    return (
        <TooltipProvider>
            <div
                data-testid="workspace"
                className="relative flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground"
            >
                {props.openable !== false && (
                    <input
                        ref={openInputRef}
                        type="file"
                        accept={oTool.accepts}
                        className="hidden"
                        onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) props.onOpenFile(f);
                            e.target.value = "";
                        }}
                    />
                )}

                <Toolbar
                    toolId={props.toolId}
                    documentName={props.documentName}
                    documentSuffix={props.tabs.length > 1 ? props.tabs[props.tab]?.label : undefined}
                    accept={oTool.accepts}
                    openable={props.openable ?? true}
                    onOpenFile={props.onOpenFile}
                    onNew={() => { props.onClose(); props.params.reset(); }}
                    canNew={!props.empty}
                    undo={props.params.undo}
                    redo={props.params.redo}
                    canUndo={props.params.canUndo}
                    canRedo={props.params.canRedo}
                    undoLabel={props.params.undoLabel}
                    redoLabel={props.params.redoLabel}
                    exports={props.exports}
                    sendTo={props.sendTo}
                    exportFormat={exportFormat}
                    onExportFormat={setExportFormat}
                    exportDisabled={!bExportable}
                    sidebarOpen={chrome.sidebarOpen}
                    onToggleSidebar={chrome.toggleSidebar}
                    inspectorOpen={chrome.inspectorOpen}
                    onToggleInspector={chrome.toggleInspector}
                    base={base}
                />

                <div className="relative flex min-h-0 flex-1">
                    <Sidebar
                        open={chrome.sidebarOpen}
                        name={props.documentName}
                        from={props.from}
                        tabs={props.tabs}
                        tab={props.tab}
                        onTab={props.onTab}
                        tabNoun={props.tabNoun ?? "Canvas"}
                        onReplace={() => openInputRef.current?.click()}
                        onClose={props.onClose}
                        openable={props.openable ?? true}
                        history={props.params.history}
                        historyIndex={props.params.historyIndex}
                        onHistoryJump={props.params.jumpTo}
                        blocks={props.sidebarBlocks}
                        onAbout={openAbout}
                    />

                    <div className="flex min-w-0 flex-1 flex-col">
                        <Stage
                            spec={props.stage}
                            empty={props.empty}
                            busy={props.busy}
                            accept={oTool.accepts}
                            openable={props.openable ?? true}
                            onOpenFile={props.onOpenFile}
                            emptyTitle={props.emptyTitle ?? `Drop ${oTool.accepts} here`}
                            emptySub={props.emptySub ?? "or click to browse — everything runs in your browser, nothing is uploaded"}
                            busyTitle={props.busyTitle}
                            busySub={props.busySub}
                            legend={props.legend}
                            prefs={chrome.prefs}
                            onPrefs={chrome.setPrefs}
                            extraToggles={props.stageToggles}
                            readout={readout}
                            error={props.error}
                            apiRef={stageApi}
                            className="min-h-0 flex-1"
                        />

                        {openPanel && (
                            <section
                                aria-label={openPanel.title}
                                data-testid="bottom-panel"
                                className="flex h-80 shrink-0 flex-col border-t border-line bg-panel"
                            >
                                <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2" role="tablist">
                                    {props.bottomPanels?.map(o => (
                                        <button
                                            key={o.id}
                                            role="tab"
                                            aria-selected={o.id === bottomTab}
                                            onClick={() => setBottomTab(o.id)}
                                            className={cn(
                                                "rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors",
                                                o.id === bottomTab
                                                    ? "bg-panel-2 text-foreground"
                                                    : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {o.title}
                                        </button>
                                    ))}
                                    <span className="flex-1" />
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Close panel"
                                        onClick={() => setBottomTab("")}
                                    >
                                        <X className="size-3.5" />
                                    </Button>
                                </div>
                                <div className="scroll-slim min-h-0 flex-1 overflow-auto overscroll-contain p-3">
                                    {openPanel.children}
                                </div>
                            </section>
                        )}
                    </div>

                    <Inspector
                        open={chrome.inspectorOpen}
                        subject={props.subject}
                        subtitle={props.subtitle}
                        empty={props.inspectorEmpty ?? props.empty}
                        onReset={props.params.reset}
                        canReset={props.params.canUndo || props.params.canRedo}
                    >
                        {props.children}
                    </Inspector>

                    {/* On a narrow screen the panels float; a scrim makes the one
                        that is open feel like a sheet you dismiss, not a layer you
                        are stuck behind. */}
                    {chrome.floating && (chrome.sidebarOpen || chrome.inspectorOpen) && (
                        <button
                            aria-label="Close panel"
                            onClick={() => {
                                if (chrome.sidebarOpen) chrome.toggleSidebar();
                                if (chrome.inspectorOpen) chrome.toggleInspector();
                            }}
                            className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
                        />
                    )}
                </div>

                <Statusbar
                    stats={props.stats}
                    warnings={props.warnings}
                    readout={readout}
                    bottomPanels={props.bottomPanels?.map(o => ({ id: o.id, title: o.title }))}
                    bottomTab={bottomTab}
                    onBottomTab={setBottomTab}
                />
            </div>
        </TooltipProvider>
    );
}
