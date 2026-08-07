import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

// shadcn/ui Button, with the variants this workspace actually needs.
//
// There is exactly one `default` (accent-filled) button visible at a time —
// Export. Everything else is ghost or outline, which is what keeps the chrome
// quiet enough for the drawing to be the loudest thing on screen.

export const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors " +
        "disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default: "bg-accent text-[#04262c] hover:bg-accent/90 font-semibold",
                secondary: "bg-elevated text-foreground hover:bg-elevated/70",
                outline: "border border-line-strong bg-transparent text-foreground hover:bg-panel-2 hover:border-accent/40",
                ghost: "text-muted-foreground hover:bg-panel-2 hover:text-foreground",
                subtle: "text-subtle-foreground hover:bg-panel-2 hover:text-foreground",
                danger: "bg-danger/15 text-danger hover:bg-danger/25"
            },
            size: {
                default: "h-8 px-3",
                sm: "h-7 px-2.5 text-xs",
                lg: "h-9 px-4",
                icon: "size-8",
                "icon-sm": "size-7"
            }
        },
        defaultVariants: { variant: "ghost", size: "default" }
    }
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
    }
);
Button.displayName = "Button";
