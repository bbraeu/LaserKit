import * as React from "react";
import { cn } from "../../lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(
                "h-7 w-full rounded-md border border-line-strong bg-panel-2 px-2 text-xs text-foreground",
                "transition-colors outline-none placeholder:text-subtle-foreground hover:border-accent/40 focus:border-accent/60",
                "disabled:pointer-events-none disabled:opacity-40",
                // The spinners are noise on a millimetre field you drag a slider for.
                "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                className
            )}
            {...props}
        />
    )
);
Input.displayName = "Input";
