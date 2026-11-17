import { quickselect } from "../analysis/stats";
import type { LoadedDataset } from "../dataset/types";
import { createDataset } from "../dataset/types";
import { fetchNifti } from "../normalization/templates";

/** Marks a dataset as a label atlas (integer region indices) with its label table. */
export interface AtlasInfo {
  name: string;
  labels: Map<number, string>;
  attribution?: string;
}

const BASE = `${import.meta.env.BASE_URL}atlases/`;

export const BUNDLED_CEREBRA = {
  name: "CerebrA (102 Regionen, MNI 2009c)",
  image: `${BASE}CerebrA_MNI152NLin2009cAsym_res-02_dseg.nii.gz`,
  table: `${BASE}CerebrA_labels.tsv`,
  attribution:
    "CerebrA (Manera et al. 2020, Sci Data 7:237), CC0 1.0; erstellt auf MNI-ICBM2009c symmetrisch, für Recon Studio auf das 2-mm-Raster der asymmetrischen Vorlage übertragen.",
};

/**
 * Parses a label table: TSV/CSV ("index,name"), FSL/FreeSurfer LUTs ("index name r g b a") or ITK-SNAP
 * label files ('index r g b a vis msh "name"'). A header row and comment lines (#) are skipped.
 */
export function parseLabelTable(text: string): Map<number, string> {
  const labels = new Map<number, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const quoted = line.match(/"([^"]*)"/);
    const tokens = line.replace(/"[^"]*"/g, " ").split(/[\t,;]|\s+/).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length || !/^\d+$/.test(tokens[0])) continue;
    const index = Number(tokens[0]);
    let name = quoted?.[1];
    if (!name) {
      // Prefer a tab/comma/semicolon separated second column (names may contain spaces).
      const cols = line.split(/[\t,;]/).map((c) => c.trim());
      name = cols.length > 1 && cols[1] && !/^-?[\d.]+$/.test(cols[1]) ? cols[1] : tokens.slice(1).filter((t) => !/^-?[\d.]+$/.test(t)).join(" ");
    }
    if (index > 0 && name) labels.set(index, name);
  }
  return labels;
}

export async function loadBundledAtlas(): Promise<LoadedDataset> {
  const [img, table] = await Promise.all([
    fetchNifti(BUNDLED_CEREBRA.image),
    fetch(BUNDLED_CEREBRA.table).then((r) => {
      if (!r.ok) throw new Error(`Atlas-Tabelle konnte nicht geladen werden (${r.status}).`);
      return r.text();
    }),
  ]);
  const d = createDataset(img.volume, { kind: "nifti", fileName: "CerebrA_MNI152NLin2009cAsym_res-02_dseg.nii.gz", nifti: img.nifti }, BUNDLED_CEREBRA.name);
  return { ...d, atlas: { name: BUNDLED_CEREBRA.name, labels: parseLabelTable(table), attribution: BUNDLED_CEREBRA.attribution } };
}

/** Atlas from a label image; without a table the regions are named by their index. */
export function atlasFromLabels(data: Float32Array, name: string, table?: Map<number, string>): AtlasInfo {
  const labels = new Map<number, string>(table ?? []);
  for (let i = 0; i < data.length; i++) {
    const l = Math.round(data[i]);
    if (l > 0 && !labels.has(l)) labels.set(l, `Region ${l}`);
  }
  return { name, labels };
}

export interface RegionStat {
  index: number;
  name: string;
  voxels: number;
  volumeMl: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
}

/** Statistics of `values` in every atlas region (`labels` on the same grid). Regions without voxels are omitted. */
export function regionStats(values: Float32Array, labels: Float32Array, atlas: AtlasInfo, voxelMl: number): RegionStat[] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const l = Math.round(labels[i]);
    if (l <= 0 || !atlas.labels.has(l)) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    let g = groups.get(l);
    if (!g) groups.set(l, (g = []));
    g.push(v);
  }
  const out: RegionStat[] = [];
  for (const [index, name] of atlas.labels) {
    const g = groups.get(index);
    if (!g?.length) continue;
    const a = Float64Array.from(g);
    let s = 0, ss = 0, min = Infinity, max = -Infinity;
    for (const v of a) {
      s += v;
      ss += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const n = a.length;
    const mean = s / n;
    const median = n % 2 ? quickselect(a, (n - 1) / 2) : 0.5 * (quickselect(a, n / 2 - 1) + quickselect(a, n / 2));
    out.push({ index, name, voxels: n, volumeMl: n * voxelMl, mean, median, sd: n > 1 ? Math.sqrt(Math.max(0, (ss - (s * s) / n) / (n - 1))) : 0, min, max });
  }
  return out;
}

/** Voxel-weighted mean over several regions (reference region for SUVR). */
export function pooledMean(stats: RegionStat[], indices: Set<number>): number {
  let s = 0, n = 0;
  for (const r of stats)
    if (indices.has(r.index)) {
      s += r.mean * r.voxels;
      n += r.voxels;
    }
  return n ? s / n : NaN;
}

export interface ReferencePreset {
  id: string;
  label: string;
  match: (name: string) => boolean;
}

/** Common SUVR reference regions, matched by region name (English and German atlas tables). */
export const REFERENCE_PRESETS: ReferencePreset[] = [
  { id: "cerebellum-gm", label: "Kleinhirnrinde (grau)", match: (n) => /cerebell\w*\s+(gr[ae]y|cortex)|kleinhirnrinde/i.test(n) },
  { id: "cerebellum", label: "Kleinhirn gesamt (inkl. Vermis)", match: (n) => /cerebell|vermis|vermal|kleinhirn/i.test(n) },
  { id: "pons", label: "Pons / Hirnstamm", match: (n) => /\bpons\b|brain\s*stem|brainstem|hirnstamm/i.test(n) },
  { id: "whole", label: "Ganzes Gehirn (alle Regionen)", match: () => true },
];

export function presetIndices(atlas: AtlasInfo, preset: ReferencePreset): Set<number> {
  const s = new Set<number>();
  for (const [i, n] of atlas.labels) if (preset.match(n)) s.add(i);
  return s;
}

/** CSV (semicolon separated, decimal comma for German spreadsheets) of regional values and SUVR. */
export function regionCsv(stats: RegionStat[], refMean: number, meta: { dataset: string; atlas: string; reference: string; unit: string }): string {
  const f = (v: number, d = 4) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "");
  const head = [
    `# Datensatz: ${meta.dataset}`,
    `# Atlas: ${meta.atlas}`,
    `# Referenzregion: ${meta.reference} (Mittelwert ${f(refMean)} ${meta.unit})`,
    ["Index", "Region", "Voxel", "Volumen_ml", `Mittel_${meta.unit}`, "Median", "SD", "Min", "Max", "SUVR"].join(";"),
  ];
  const rows = stats.map((r) => [r.index, `"${r.name.replace(/"/g, "'")}"`, r.voxels, f(r.volumeMl, 2), f(r.mean), f(r.median), f(r.sd), f(r.min), f(r.max), f(r.mean / refMean)].join(";"));
  return [...head, ...rows].join("\n") + "\n";
}
