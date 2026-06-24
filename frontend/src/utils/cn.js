import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// cn = className utility that merges Tailwind classes safely
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
