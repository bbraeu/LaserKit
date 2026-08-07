import { useCallback, useState } from "react";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import {
    DropdownCheck, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel, DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import { Badge } from "../components/ui/badge";
import { downloadBlob, trackEvent } from "../lib/util";
import type { ExportItem } from "./types";

// ---------------------------------------------------------------------------
// Writing a file.
//
// Before this, "export" was four different shapes in four different places: a
// split button here, two plain buttons there, a zip button in a header, a parts
// button beside a format menu — and on a page you had not used before you had
// to hunt for it. Now it is always the same control in the same corner of the
// toolbar: the design itself goes through the split button, whose main half
// repeats the last format you chose (in practice you export the same one over
// and over while you iterate), and whose menu is the format list and nothing
// else.
//
// A tool's *companion* files — the stamp's parts sheet, the contour's outline
// over the design, the converter's zip of every canvas — are not formats of the
// design, so they are not in that list. They stand beside it as their own named
// buttons, see ExportExtras below.
// ---------------------------------------------------------------------------

/** Shared by both controls: build the file, save it, count it. */
const useDownloader = () => {
    const [busy, setBusy] = useState<string | null>(null);
    const run = useCallback(async (o: ExportItem) => {
        if (o.blocked) return;
        setBusy(o.id);
        try {
            downloadBlob(await o.blob(), o.filename);
            trackEvent(o.event);
        } finally {
            setBusy(null);
        }
    }, []);
    return { busy, run };
};

export interface ExportMenuProps {
    items: ExportItem[];
    /** id of the format the main half acts on */
    active: string;
    onActiveChange: (id: string) => void;
    disabled?: boolean;
}

export function ExportMenu({ items, active, onActiveChange, disabled }: ExportMenuProps) {
    const { busy, run } = useDownloader();

    const aDesign = items.filter(o => (o.group ?? "design") === "design"),
        // The remembered format may not be available for this canvas (a raster
        // cannot go into a DXF), so the button falls back to the first that is.
        oActive = aDesign.find(o => o.id === active && !o.blocked)
            ?? aDesign.find(o => !o.blocked)
            ?? aDesign[0];

    const bDead = disabled || !oActive || !!oActive.blocked;

    return (
        <div className="flex">
            <Button
                variant="default"
                size="default"
                disabled={bDead}
                title={oActive ? `Saves ${oActive.filename}` : undefined}
                onClick={() => oActive && void run(oActive)}
                className="rounded-r-none pr-2.5"
                data-testid="export-button"
            >
                {busy && busy === oActive?.id
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Download className="size-3.5" />}
                Export
                {oActive && <span className="font-mono text-[11px] opacity-70">.{oActive.label.toLowerCase()}</span>}
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="default"
                        size="icon"
                        disabled={disabled}
                        aria-label="Choose what to export"
                        className="w-7 rounded-l-none border-l border-black/20"
                        data-testid="export-menu"
                    >
                        <ChevronDown className="size-3.5" />
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent className="w-84">
                    <DropdownMenuLabel>The design as</DropdownMenuLabel>
                    {aDesign.map(o => (
                        <DropdownMenuItem
                            key={o.id}
                            disabled={!!o.blocked}
                            onSelect={() => { onActiveChange(o.id); void run(o); }}
                        >
                            <DropdownCheck checked={o.id === oActive?.id} />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="font-medium">{o.label}</span>
                                    <Badge variant={o.blocked ? "warn" : "default"}>
                                        {o.blocked ? "unavailable" : o.note ?? o.id}
                                    </Badge>
                                </span>
                                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                                    {o.blocked ?? o.desc}
                                </span>
                            </span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

/**
 * The tool's companion files, each as its own toolbar button.
 *
 * These earn the space because they are the *other thing you came for*: nobody
 * makes a stamp face without also cutting the mount, and burying that behind a
 * dropdown made it look optional. The label collapses to the icon below a wide
 * screen, and the full name stays in the tooltip along with the file it writes.
 */
export function ExportExtras({ items, disabled }: { items: ExportItem[]; disabled?: boolean }) {
    const { busy, run } = useDownloader();
    const aExtra = items.filter(o => o.group === "extra");
    if (!aExtra.length) return null;

    return (
        <>
            {aExtra.map(o => (
                <Button
                    key={o.id}
                    variant="outline"
                    disabled={disabled || !!o.blocked}
                    title={o.blocked ?? `${o.desc} — saves ${o.filename}`}
                    onClick={() => void run(o)}
                    data-testid={`export-extra-${o.id}`}
                >
                    {busy === o.id
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <Download className="size-3.5" />}
                    <span className="hidden xl:inline">{o.label}</span>
                </Button>
            ))}
        </>
    );
}
