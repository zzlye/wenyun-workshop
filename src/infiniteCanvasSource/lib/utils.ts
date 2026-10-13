import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export { nanoid as randomId } from "nanoid";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
