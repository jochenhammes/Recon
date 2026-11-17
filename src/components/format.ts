const intFmt = new Intl.NumberFormat("de-DE");

/** Formats a voxel value compactly: integers as-is, otherwise up to 5 significant digits. */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (Number.isInteger(v)) return intFmt.format(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e7)) return v.toExponential(3).replace(".", ",");
  return new Intl.NumberFormat("de-DE", { maximumSignificantDigits: 5 }).format(v);
}

export function formatCount(n: number): string {
  return intFmt.format(n);
}

export type UnitMode = "raw" | "suv";

/** Parses a number typed with either decimal separator; NaN for empty/invalid input. */
export function parseInput(s: string): number {
  return s.trim() === "" ? NaN : Number(s.trim().replace(",", "."));
}

/** Formats a value for an input field (dot decimal, 6 significant digits). */
export function formatInput(v: number): string {
  return String(Number(v.toPrecision(6)));
}
