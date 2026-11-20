/** Long file names shortened for lists (the full name is the tooltip). */
export function shortLabel(label: string, max = 42): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
