import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const signed = (value: number) => value >= 0 ? `+${value}` : String(value);
export const titleCase = (value: string) => value.replace(/(^|[ -])\w/g, c => c.toUpperCase());
