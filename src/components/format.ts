import { getLang, locale } from "../i18n/lang";

const intFmt = () => new Intl.NumberFormat(locale());

/** Formats a voxel value compactly: integers as-is, otherwise up to 5 significant digits. */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (Number.isInteger(v)) return intFmt().format(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e7)) return getLang() === "de" ? v.toExponential(3).replace(".", ",") : v.toExponential(3);
  return new Intl.NumberFormat(locale(), { maximumSignificantDigits: 5 }).format(v);
}

export function formatCount(n: number): string {
  return intFmt().format(n);
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

/** Number with fixed decimals in the UI language (decimal comma in German, point in English). */
export function fmtFixed(v: number, digits: number): string {
  return Number.isFinite(v) ? v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "–";
}

/** Number in the UI language with at most `digits` decimals. */
export function fmtNum(v: number, maxDigits = 3): string {
  return Number.isFinite(v) ? v.toLocaleString(locale(), { maximumFractionDigits: maxDigits }) : "–";
}

/** Date and time in the UI language (dd.mm.yyyy hh:mm or dd/mm/yyyy hh:mm). */
export function fmtDateTimeUi(ms: number): string {
  return new Date(ms).toLocaleString(locale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
