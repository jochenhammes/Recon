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
  /** Sample variance (n − 1). */
  variance: number;
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
    const variance = n > 1 ? Math.max(0, (ss - (s * s) / n) / (n - 1)) : 0;
    out.push({ index, name, voxels: n, volumeMl: n * voxelMl, mean, median, sd: Math.sqrt(variance), variance, min, max });
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
    ["Index", "Region", "Voxel", "Volumen_ml", `Mittel_${meta.unit}`, "Median", "SD", "Varianz", "Min", "Max", "SUVR"].join(";"),
  ];
  const rows = stats.map((r) => [r.index, `"${r.name.replace(/"/g, "'")}"`, r.voxels, f(r.volumeMl, 2), f(r.mean), f(r.median), f(r.sd), f(r.variance, 6), f(r.min), f(r.max), f(r.mean / refMean)].join(";"));
  return [...head, ...rows].join("\n") + "\n";
}

/** CSV of a label-based analysis (semicolon separated, decimal comma): one row per region. */
export function labelStatsCsv(stats: RegionStat[], meta: { dataset: string; atlas: string; unit: string; note?: string }): string {
  const f = (v: number, d = 4) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "");
  const u = meta.unit ? `_${meta.unit}` : "";
  const head = [
    `# Datensatz: ${meta.dataset}`,
    `# Labels: ${meta.atlas}`,
    ...(meta.note ? [`# ${meta.note}`] : []),
    ["Index", "Region", "Voxel", "Volumen_ml", `Mittel${u}`, `SD${u}`, `Varianz${u}${u ? "²" : ""}`, `Median${u}`, `Min${u}`, `Max${u}`].join(";"),
  ];
  const rows = stats.map((r) => [r.index, `"${r.name.replace(/"/g, "'")}"`, r.voxels, f(r.volumeMl, 3), f(r.mean), f(r.sd), f(r.variance, 6), f(r.median), f(r.min), f(r.max)].join(";"));
  return [...head, ...rows].join("\n") + "\n";
}

/** Values of `values` inside the given regions (labels on the same grid), e.g. for a histogram. */
export function regionValues(values: Float32Array, labels: Float32Array, indices: Set<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < labels.length; i++) if (indices.has(Math.round(labels[i])) && Number.isFinite(values[i])) n++;
  const out = new Float32Array(n);
  for (let i = 0, k = 0; i < labels.length; i++) if (indices.has(Math.round(labels[i])) && Number.isFinite(values[i])) out[k++] = values[i];
  return out;
}

/**
 * Picks the label image and its table from a ZIP archive (e.g. the AAL3 download: AAL3v1.nii.gz +
 * AAL3v1.nii.txt, also 1-mm versions): prefers a NIfTI with a matching table, then the coarser (not "1mm") one.
 */
export function pickAtlasEntries<T extends { name: string }>(entries: T[]): { image: T; table?: T } | null {
  const base = (n: string) => n.split("/").pop()!.replace(/\.nii(\.gz)?$/i, "").replace(/\.(nii\.)?(txt|tsv|csv|lut|label|xml)$/i, "").toLowerCase();
  const visible = entries.filter((e) => !e.name.split("/").some((p) => p.startsWith(".") || p === "__MACOSX"));
  const images = visible.filter((e) => /\.nii(\.gz)?$/i.test(e.name));
  const tables = visible.filter((e) => /\.(txt|tsv|csv|lut|label)$/i.test(e.name) && !/readme|licen[cs]e/i.test(e.name));
  if (!images.length) return null;
  const score = (e: T) => (tables.some((t) => base(t.name) === base(e.name)) ? 4 : 0) + (/1mm/i.test(e.name) ? 0 : 2) + (/^aal/i.test(base(e.name)) ? 1 : 0);
  const image = [...images].sort((a, b) => score(b) - score(a))[0];
  return { image, table: tables.find((t) => base(t.name) === base(image.name)) ?? (tables.length === 1 ? tables[0] : undefined) };
}

export interface LabelHistogramOptions {
  bins: number;
  /** Value range of the bins; default: min–max over all labelled voxels of the dataset. */
  min?: number;
  max?: number;
  /** Percent of the region's voxels instead of voxel counts. */
  relative?: boolean;
}

/**
 * Histogram per region as CSV: one row per label, one column per bin (same bins for all regions, so rows are
 * comparable). Values outside the range are counted in the first/last bin (noted in the header).
 */
export function labelHistogramCsv(
  values: Float32Array,
  labels: Float32Array,
  regions: { index: number; name: string }[],
  opts: LabelHistogramOptions,
  meta: { dataset: string; atlas: string; unit: string; note?: string },
): string {
  const bins = Math.max(1, Math.floor(opts.bins));
  const row = new Map<number, number>();
  regions.forEach((r, i) => row.set(r.index, i));
  let lo = opts.min ?? Infinity, hi = opts.max ?? -Infinity;
  if (opts.min === undefined || opts.max === undefined) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < labels.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v) || !row.has(Math.round(labels[i]))) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (opts.min === undefined) lo = Number.isFinite(mn) ? mn : 0;
    if (opts.max === undefined) hi = Number.isFinite(mx) ? mx : 1;
  }
  if (!(hi > lo)) hi = lo + 1;
  const width = (hi - lo) / bins;
  const counts = regions.map(() => new Float64Array(bins));
  const totals = new Float64Array(regions.length);
  for (let i = 0; i < labels.length; i++) {
    const r = row.get(Math.round(labels[i]));
    const v = values[i];
    if (r === undefined || !Number.isFinite(v)) continue;
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[r][b]++;
    totals[r]++;
  }
  const f = (v: number, d = 4) => (Number.isFinite(v) ? Number(v.toPrecision(6)).toFixed(d).replace(".", ",") : "");
  const u = meta.unit ? ` ${meta.unit}` : "";
  const head = [
    `# Datensatz: ${meta.dataset}`,
    `# Labels: ${meta.atlas}`,
    ...(meta.note ? [`# ${meta.note}`] : []),
    `# ${bins} Bins von ${f(lo)} bis ${f(hi)}${u} (Breite ${f(width, 6)}); Spaltenkopf = Bin-Untergrenze; Werte außerhalb in der ersten/letzten Bin; ${opts.relative ? "Anteil der Voxel der Region in %" : "Anzahl Voxel"}`,
    ["Index", "Region", "Voxel", ...Array.from({ length: bins }, (_, b) => f(lo + b * width))].join(";"),
  ];
  const rows = regions.map((r, i) =>
    [r.index, `"${r.name.replace(/"/g, "'")}"`, totals[i], ...Array.from(counts[i], (c) => (opts.relative ? f(totals[i] ? (100 * c) / totals[i] : 0, 4) : String(c)))].join(";"),
  );
  return [...head, ...rows].join("\n") + "\n";
}
