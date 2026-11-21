/**
 * Label harmonization between CT segmentation models: every structure name is mapped to a canonical name
 * (TotalSegmentator v2 names, underscores) so that exclusion lists, liver reference, dosimetry and the model
 * benchmark work with every model.
 */

const ALIASES: Record<string, string> = {
  // TotalSegmentator v1 / MONAI wholeBody (104 classes): heart parts → heart
  heart_myocardium: "heart",
  heart_atrium_left: "heart",
  heart_atrium_right: "heart",
  heart_ventricle_left: "heart",
  heart_ventricle_right: "heart",
  // AMOS / common reference names
  right_kidney: "kidney_right",
  left_kidney: "kidney_left",
  postcava: "inferior_vena_cava",
  ivc: "inferior_vena_cava",
  right_adrenal_gland: "adrenal_gland_right",
  left_adrenal_gland: "adrenal_gland_left",
  bladder: "urinary_bladder",
  arota: "aorta", // typo in the AMOS label table
  gall_bladder: "gallbladder",
  // MOOSE-style names
  kidneys: "kidney",
  adrenal_glands: "adrenal_gland",
  lungs: "lung",
};

/** Canonical structure name ("kidney left", "Kidney_Left" → "kidney_left"; heart parts → "heart"). */
export function canonicalName(name: string): string {
  const n = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALIASES[n] ?? n;
}

/** Coarser groups used to compare models with different detail (lung lobes → lung, left/right kept). */
export function canonicalGroup(name: string): string {
  const c = canonicalName(name);
  if (/^lung_/.test(c)) return "lung";
  if (/^thyroid_(left|right)$/.test(c)) return "thyroid_gland"; // MOOSE: lobes
  if (/^kidney_cyst_/.test(c)) return c.replace("_cyst", "");
  return c;
}

/** Label numbers per canonical name of a label table (several labels can map to one name, e.g. heart parts). */
export function labelsByCanonical(labels: Map<number, string> | Record<string, string>, group = false): Map<string, Set<number>> {
  const entries: [number, string][] = labels instanceof Map ? [...labels] : Object.entries(labels).map(([k, v]) => [Number(k), v]);
  const out = new Map<string, Set<number>>();
  for (const [id, name] of entries) {
    if (!id) continue;
    const key = group ? canonicalGroup(name) : canonicalName(name);
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(id);
  }
  return out;
}
