import { ArrowRight, Share2 } from "lucide-react";
import { Button } from "../components/ui/button";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import { handoffTargets, sendToTool } from "../lib/handoff";
import { getTool } from "../lib/tools";
import { trackEvent } from "../lib/util";
import type { SendToSpec } from "./types";

// ---------------------------------------------------------------------------
// "Send to another tool" — hands what this tool just made to the next one
// without the round trip through the download folder.
//
// It sits in the toolbar beside Export because that is where the outputs of a
// document live, but it is deliberately not shaped like Export: that one writes
// a file and ends the job, this one saves nothing and takes you somewhere else.
// So it is outlined in the accent rather than filled with it, and its icon is an
// arrow leading out rather than a tray arrow coming down — different enough to
// never be clicked by mistake, prominent enough to be found.
// ---------------------------------------------------------------------------

export function SendToMenu({ toolId, spec }: { toolId: string; spec: SendToSpec }) {
    const aTarget = handoffTargets(toolId);
    if (!aTarget.length) return null;

    const send = (to: string): void => {
        // Event names as configured in Google Analytics: SEND_trace_to_stamp, …
        trackEvent(`SEND_${toolId}_to_${to}`);
        sendToTool(to, { svg: spec.svg(), name: spec.name, from: toolId });
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    disabled={spec.disabled}
                    data-testid="send-to"
                    title="Carry this design straight on to another tool — nothing saved, nothing uploaded"
                    className="border-accent/40 bg-accent/8 text-accent hover:border-accent/70 hover:bg-accent/15 hover:text-accent"
                >
                    <Share2 className="size-3.5" />
                    <span className="hidden lg:inline">Send to</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
                <DropdownMenuLabel>Carry this design on</DropdownMenuLabel>
                {aTarget.map(id => {
                    const oTo = getTool(id);
                    return (
                        <DropdownMenuItem key={id} onSelect={() => send(id)}>
                            <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-accent" />
                            <span className="min-w-0 flex-1">
                                <span className="block font-medium">{oTo.short}</span>
                                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{oTo.hint}</span>
                            </span>
                        </DropdownMenuItem>
                    );
                })}
                <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-snug text-subtle-foreground">
                    Goes straight across — no file saved, nothing uploaded.
                </p>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
