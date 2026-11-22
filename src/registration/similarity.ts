import type { CostName } from "./cost";

import { t } from "../i18n";
/** Converts a cost value (lower is better) to the displayed similarity. */
export function similarity(cost: CostName, v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (v >= 10) return t("keine Überlappung");
  if (cost === "cr") return `CR ${(1 - v).toFixed(4)}`;
  if (cost === "ncc") return `NCC ${(-v).toFixed(4)}`;
  return `${cost.toUpperCase()} ${(-v).toFixed(4)}`;
}
