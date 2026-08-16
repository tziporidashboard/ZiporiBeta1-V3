/**
 * utils.ts \u2014 shared Tailwind class-name helper (standard shadcn/ui
 * convention).
 *
 * `cn(...)` merges conditional class names via `clsx` and dedupes/merges
 * conflicting Tailwind utility classes via `tailwind-merge`.
 *
 * Called by: virtually every component in `@/components/ui/` and many
 *   feature components, for building conditional `className` strings.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
