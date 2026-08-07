import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/cn";

export const TooltipProvider = ({ delayDuration = 350, ...props }: TooltipPrimitive.TooltipProviderProps) => (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={200} {...props} />
);

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
    React.ComponentRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
    <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            className={cn(
                "z-[90] max-w-64 rounded-md border border-line-strong bg-elevated px-2.5 py-1.5",
                "text-xs leading-snug text-foreground shadow-xl shadow-black/50 animate-in-fade",
                className
            )}
            {...props}
        />
    </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

/** The 90 % case: an icon button that needs a name. */
export function Hint({ label, children, side = "bottom" }: {
    label: React.ReactNode;
    children: React.ReactNode;
    side?: "top" | "right" | "bottom" | "left";
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent side={side}>{label}</TooltipContent>
        </Tooltip>
    );
}
