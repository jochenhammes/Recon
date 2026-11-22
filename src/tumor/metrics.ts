import { csvWithInfo } from "../core/csv";
import type { Lesion } from "./segment";

import { t } from "../i18n";
export interface TumorBurden {
  lesions: number;
  /** Total metabolic tumor volume (ml). */
  tmtv: number;
  /** Total lesion glycolysis / total lesion PSMA (ml·SUV). */
  tlg: number;
  suvMax: number;
  /** Volume-weighted mean SUV of all lesions. */
  suvMean: number;
  /** Largest distance between two lesion centroids (mm); 0 for fewer than two lesions. */
  dmax: number;
  /** Distance from the largest (bulky) lesion to the lesion farthest from it (mm). */
  dmaxBulk: number;
}

const dist = (a: Lesion, b: Lesion) => Math.hypot(a.centroid[0] - b.centroid[0], a.centroid[1] - b.centroid[1], a.centroid[2] - b.centroid[2]);

/** Whole-body tumor burden of the included lesions (Dmax after Cottereau et al.). */
export function tumorBurden(all: Lesion[]): TumorBurden {
  const ls = all.filter((l) => l.included);
  const tmtv = ls.reduce((s, l) => s + l.volumeMl, 0);
  const tlg = ls.reduce((s, l) => s + l.tlg, 0);
  let dmax = 0;
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) dmax = Math.max(dmax, dist(ls[i], ls[j]));
  let dmaxBulk = 0;
  if (ls.length > 1) {
    const bulk = ls.reduce((a, b) => (b.volumeMl > a.volumeMl ? b : a));
    for (const l of ls) if (l !== bulk) dmaxBulk = Math.max(dmaxBulk, dist(bulk, l));
  }
  return {
    lesions: ls.length,
    tmtv,
    tlg,
    suvMax: ls.reduce((m, l) => Math.max(m, l.suvMax), ls.length ? -Infinity : NaN),
    suvMean: tmtv > 0 ? tlg / tmtv : NaN,
    dmax,
    dmaxBulk,
  };
}

/** CSV (semicolon, decimal comma) of burden and lesion table. */
export function burdenCsv(b: TumorBurden, lesions: Lesion[], meta: { dataset: string; method: string; tlgLabel: string }): string {
  const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "");
  const lines = [
    ["Nr", "einbezogen", t("geprüft"), "Volumen_ml", "SUVmax", "SUVpeak", "SUVmean", meta.tlgLabel, "x_mm", "y_mm", "z_mm", "Ort", "Knochen", "Hinweis"].join(";"),
    ...lesions.map((l) => [l.id, l.included ? "ja" : "nein", l.reviewed ? (l.included ? t("bestätigt") : "verworfen") : "offen", f(l.volumeMl), f(l.suvMax), f(l.suvPeak), f(l.suvMean), f(l.tlg), ...l.centroid.map((c) => f(c, 1)), l.organ ?? "", l.bone ? "ja" : "", l.note ?? ""].join(";")),
  ];
  return csvWithInfo(lines, [
    ["Datensatz", meta.dataset],
    ["Methode", meta.method],
    [t("Läsionen"), String(b.lesions)],
    [t("Geprüft"), t("{v} von {length}", { v: lesions.filter((l) => l.reviewed).length, length: lesions.length })],
    ["TMTV ml", f(b.tmtv)],
    [meta.tlgLabel, f(b.tlg)],
    ["SUVmax", f(b.suvMax)],
    ["Dmax mm", f(b.dmax, 1)],
    ["Dmax_bulk mm", f(b.dmaxBulk, 1)],
  ]);
}

/** Burden split into bone and soft-tissue lesions (PSMA). */
export function splitBurden(all: Lesion[]): { bone: TumorBurden; soft: TumorBurden } {
  return { bone: tumorBurden(all.filter((l) => l.bone)), soft: tumorBurden(all.filter((l) => !l.bone)) };
}
