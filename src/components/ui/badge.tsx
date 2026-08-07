import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

export const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
    {
        variants: {
            variant: {
                default: "bg-elevated text-muted-foreground",
                accent: "bg-accent/12 text-accent",
                warn: "bg-warn/12 text-warn",
                danger: "bg-danger/12 text-danger",
                ok: "bg-ok/12 text-ok",
                outline: "border border-line-strong text-muted-foreground"
            }
        },
        defaultVariants: { variant: "default" }
    }
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
