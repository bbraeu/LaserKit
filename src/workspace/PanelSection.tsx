import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { cn } from "../lib/cn";

// A section of the left or the right panel. Both sides use it, so a group of
// properties and a group of pages open, close and indent identically — and the
// state survives a reload, because re-collapsing the four sections you never use
// on every visit is the sort of small tax that makes an app feel unhelpful.

const KEY = "laserkit:panels";

const readOpen = (id: string, fallback: boolean): boolean => {
    if (typeof localStorage === "undefined") return fallback;
    try {
        const o = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
        return typeof o[id] === "boolean" ? o[id] : fallback;
    } catch {
        return fallback;
    }
};

const writeOpen = (id: string, open: boolean): void => {
    if (typeof localStorage === "undefined") return;
    try {
        const o = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
        o[id] = open;
        localStorage.setItem(KEY, JSON.stringify(o));
    } catch {
        /* not worth failing a click over */
    }
};

export interface PanelSectionProps {
    /** stable id — the open state is remembered under it */
    id: string;
    title: string;
    icon?: ReactNode;
    /** a count or a state, on the right of the header row */
    badge?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
    className?: string;
}

export function PanelSection({ id, title, icon, badge, defaultOpen = true, children, className }: PanelSectionProps) {
    // Read on mount rather than during render: the island is server-rendered and
    // localStorage does not exist there, so a value read too early would make the
    // first client render disagree with the HTML.
    const [open, setOpen] = useState(defaultOpen);
    useEffect(() => { setOpen(readOpen(id, defaultOpen)); }, [id, defaultOpen]);

    const onOpenChange = useCallback((b: boolean) => {
        setOpen(b);
        writeOpen(id, b);
    }, [id]);

    return (
        <Collapsible open={open} onOpenChange={onOpenChange} className={cn("border-b border-line", className)}>
            <CollapsibleTrigger
                className={cn(
                    "group flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-panel-2"
                )}
            >
                <ChevronRight
                    className={cn(
                        "size-3 shrink-0 text-subtle-foreground transition-transform",
                        open && "rotate-90"
                    )}
                />
                {icon && <span className="shrink-0 text-subtle-foreground">{icon}</span>}
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {title}
                </span>
                {badge}
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="space-y-0.5 px-3 pt-0.5 pb-3">{children}</div>
            </CollapsibleContent>
        </Collapsible>
    );
}
