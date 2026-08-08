import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../lib/cn";

export const Slider = React.forwardRef<
    React.ComponentRef<typeof SliderPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, "aria-label": ariaLabel, "aria-valuetext": ariaValueText, ...props }, ref) => (
    <SliderPrimitive.Root
        ref={ref}
        className={cn("relative flex w-full touch-none select-none items-center py-1.5", className)}
        {...props}
    >
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-elevated">
            <SliderPrimitive.Range className="absolute h-full bg-accent/70" />
        </SliderPrimitive.Track>
        {/* The thumb carries role="slider", so the name has to go on the thumb —
            on the root it names a div nothing reads. The same is true of
            `aria-valuetext`, which is how a slider says "0.15 mm" rather than
            "0.15": pass it through `...props` and it lands on the root, where it
            is as useless as the label would be. Two attributes, one reason. */}
        <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            aria-valuetext={ariaValueText}
            className={cn(
                "block size-3.5 rounded-full border-2 border-accent bg-panel transition",
                "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                "disabled:pointer-events-none disabled:opacity-40"
            )}
        />
    </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
