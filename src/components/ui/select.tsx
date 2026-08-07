import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
        ref={ref}
        className={cn(
            "flex h-7 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-panel-2 px-2.5",
            "text-xs text-foreground transition-colors hover:border-accent/40 data-placeholder:text-subtle-foreground",
            "disabled:pointer-events-none disabled:opacity-40",
            className
        )}
        {...props}
    >
        <span className="truncate">{children}</span>
        <SelectPrimitive.Icon asChild>
            <ChevronDown className="size-3.5 shrink-0 text-subtle-foreground" />
        </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
    <SelectPrimitive.Portal>
        <SelectPrimitive.Content
            ref={ref}
            position={position}
            className={cn(
                "z-[90] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg",
                "border border-line-strong bg-elevated shadow-2xl shadow-black/60 animate-in-pop",
                className
            )}
            {...props}
        >
            <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
        ref={ref}
        className={cn(
            "relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-xs outline-none",
            "text-foreground transition-colors focus:bg-panel-2 data-disabled:pointer-events-none data-disabled:opacity-40",
            className
        )}
        {...props}
    >
        <span className="absolute left-2 grid size-3.5 place-items-center">
            <SelectPrimitive.ItemIndicator>
                <Check className="size-3.5 text-accent" />
            </SelectPrimitive.ItemIndicator>
        </span>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";
