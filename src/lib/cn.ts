import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class merger: conditional classes in, last-wins Tailwind out. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
