import { useRef } from "react";
import {
    ChevronDown, FilePlus2, FolderOpen, PanelLeft, PanelRight, Redo2, Undo2, Zap
} from "lucide-react";
import { Button } from "../components/ui/button";
import {
    DropdownCheck, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel, DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import { Hint } from "../components/ui/tooltip";
import { Separator } from "../components/ui/separator";
import { TOOLS, getTool } from "../lib/tools";
import { ExportExtras, ExportMenu } from "./ExportMenu";
import { SendToMenu } from "./SendToMenu";
import type { ExportItem, SendToSpec } from "./types";

// ---------------------------------------------------------------------------
// The top bar: global actions only.
//
// The rule that shapes it is that nothing here may depend on what is *selected*.
// New, Open, Undo, Redo and the outputs are true of a document at every moment,
// so they live here; a border, a threshold or a plate shape is a property of the
// thing on the stage and lives in the inspector. That one rule is what keeps the
// bar the same height, the same shape and the same muscle memory on all four
// pages.
//
// The outputs are a graded set rather than one button, because they are not
// equally weighted. Export is the design and is filled with the accent. Beside
// it stand the tool's companion files — the stamp's parts sheet, the converter's
// zip — outlined, because you want them too but only after the design is right.
// Send to is outlined in the accent instead: it is the one control up here that
// saves nothing and moves you somewhere else, and it has to look it.
//
// The middle is the document, the way a design app names the file you are in.
// ---------------------------------------------------------------------------

export interface ToolbarProps {
    toolId: string;
    /** file name stem, empty until something is open */
    documentName: string;
    /** the canvas being shown, when the file holds more than one */
    documentSuffix?: string;
    accept: string;
    onOpenFile: (file: File) => void;
    onNew: () => void;
    canNew: boolean;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    undoLabel?: string;
    redoLabel?: string;
    exports: ExportItem[];
    sendTo?: SendToSpec;
    exportFormat: string;
    onExportFormat: (id: string) => void;
    exportDisabled: boolean;
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
    inspectorOpen: boolean;
    onToggleInspector: () => void;
    base: string;
}

export function Toolbar(props: ToolbarProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const oTool = getTool(props.toolId);

    return (
        <header data-testid="toolbar" className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
            {/* ── identity and which tool you are in ─────────────────────── */}
            <a
                href={props.base}
                title="LaserKit — all tools"
                className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-panel-2"
            >
                <span className="grid size-6 place-items-center rounded-md bg-accent/15 text-accent">
                    <Zap className="size-3.5" />
                </span>
                <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:block">LaserKit</span>
            </a>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="default" className="gap-1.5 text-foreground" data-testid="tool-switcher">
                        {oTool.short}
                        <ChevronDown className="size-3.5 opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80">
                    <DropdownMenuLabel>Tools</DropdownMenuLabel>
                    {TOOLS.map(o => (
                        <DropdownMenuItem key={o.id} asChild>
                            <a href={`${props.base}${o.slug}`} aria-current={o.id === props.toolId ? "page" : undefined}>
                                <DropdownCheck checked={o.id === props.toolId} />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium">{o.short}</span>
                                    <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{o.hint}</span>
                                </span>
                            </a>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* ── the document ───────────────────────────────────────────── */}
            <div className="pointer-events-none mx-2 hidden min-w-0 flex-1 justify-center md:flex">
                {props.documentName ? (
                    <p className="truncate text-xs text-muted-foreground">
                        <span className="text-foreground">{props.documentName}</span>
                        {props.documentSuffix && <span className="text-subtle-foreground"> · {props.documentSuffix}</span>}
                    </p>
                ) : (
                    <p className="truncate text-xs text-subtle-foreground">No file open</p>
                )}
            </div>
            <div className="flex-1 md:hidden" />

            {/* ── global actions ─────────────────────────────────────────── */}
            <input
                ref={inputRef}
                type="file"
                accept={props.accept}
                className="hidden"
                data-testid="toolbar-file-input"
                onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) props.onOpenFile(f);
                    e.target.value = ""; // so the same file can be picked again
                }}
            />

            <Hint label="Start over — clears the file and the settings">
                <Button variant="ghost" size="icon" disabled={!props.canNew} onClick={props.onNew} aria-label="New">
                    <FilePlus2 className="size-4" />
                </Button>
            </Hint>
            <Hint label={<>Open a file <span className="text-subtle-foreground">{oTool.accepts}</span></>}>
                <Button variant="ghost" size="icon" onClick={() => inputRef.current?.click()} aria-label="Open">
                    <FolderOpen className="size-4" />
                </Button>
            </Hint>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <Hint label={props.canUndo ? <>Undo {props.undoLabel ?? ""} <kbd className="ml-1 text-subtle-foreground">Ctrl Z</kbd></> : "Nothing to undo"}>
                <Button variant="ghost" size="icon" disabled={!props.canUndo} onClick={props.undo} aria-label="Undo">
                    <Undo2 className="size-4" />
                </Button>
            </Hint>
            <Hint label={props.canRedo ? <>Redo {props.redoLabel ?? ""} <kbd className="ml-1 text-subtle-foreground">Ctrl Shift Z</kbd></> : "Nothing to redo"}>
                <Button variant="ghost" size="icon" disabled={!props.canRedo} onClick={props.redo} aria-label="Redo">
                    <Redo2 className="size-4" />
                </Button>
            </Hint>

            <Separator orientation="vertical" className="mx-1 h-5" />

            {props.sendTo && <SendToMenu toolId={props.toolId} spec={props.sendTo} />}
            <ExportExtras items={props.exports} disabled={props.exportDisabled} />
            <ExportMenu
                items={props.exports}
                active={props.exportFormat}
                onActiveChange={props.onExportFormat}
                disabled={props.exportDisabled}
            />

            <Separator orientation="vertical" className="mx-1 hidden h-5 lg:block" />

            <Hint label={props.sidebarOpen ? "Hide the project panel" : "Show the project panel"}>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={props.onToggleSidebar}
                    aria-pressed={props.sidebarOpen}
                    aria-label="Toggle project panel"
                    className={props.sidebarOpen ? "text-foreground" : undefined}
                >
                    <PanelLeft className="size-4" />
                </Button>
            </Hint>
            <Hint label={props.inspectorOpen ? "Hide the properties panel" : "Show the properties panel"}>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={props.onToggleInspector}
                    aria-pressed={props.inspectorOpen}
                    aria-label="Toggle properties panel"
                    className={props.inspectorOpen ? "text-foreground" : undefined}
                >
                    <PanelRight className="size-4" />
                </Button>
            </Hint>
        </header>
    );
}
