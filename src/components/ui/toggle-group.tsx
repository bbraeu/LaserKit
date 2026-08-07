import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "../../lib/cn";

/** The segmented control: a small, closed set of choices, all visible at once. */
export const ToggleGroup = React.forwardRef<
    React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
    <ToggleGroupPrimitive.Root
        ref={ref}
        className={cn("flex w-full items-center gap-0.5 rounded-lg bg-panel-2 p-0.5", className)}
        {...props}
    />
));
ToggleGroup.displayName = "ToggleGroup";

export const ToggleGroupItem = React.forwardRef<
    React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
    <ToggleGroupPrimitive.Item
        ref={ref}
        className={cn(
            "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
            "text-muted-foreground hover:text-foreground",
            "data-[state=on]:bg-elevated data-[state=on]:text-foreground data-[state=on]:shadow-sm",
            "disabled:pointer-events-none disabled:opacity-40",
            className
        )}
        {...props}
    />
));
ToggleGroupItem.displayName = "ToggleGroupItem";
