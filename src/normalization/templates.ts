import type { LoadedDataset } from "../dataset/types";
import { createDataset } from "../dataset/types";
import { Volume3D } from "../viewer/volume";
import { decompressGzip, parseNifti1, readNiftiAll } from "../viewer/volumeLoader";

/** Marks a dataset as a standard-space template. */
export interface TemplateInfo {
  name: string;
  /** Contrast of the template (T1 MRI or tracer PET); decides the default cost function. */
  kind: "T1" | "PET";
  /** Optional brain mask on the template grid (1 = brain). */
  mask?: Float32Array | null;
  /**
   * Adaptive template: additional components on the template grid (e.g. amyloid-positive minus negative
   * mean); the registration matches base + Σ aᵢ·componentᵢ with estimated weights.
   */
  components?: Float32Array[];
  attribution?: string;
}

const BASE = `${import.meta.env.BASE_URL}templates/`;

export const BUNDLED_MNI = {
  name: "MNI152 2009c (T1, 2 mm)",
  t1: `${BASE}MNI152NLin2009cAsym_res-02_T1w.nii.gz`,
  mask: `${BASE}MNI152NLin2009cAsym_res-02_brainmask.nii.gz`,
  license: `${BASE}LICENSE-MNI152NLin2009cAsym.txt`,
  attribution:
    "ICBM 152 Nonlinear Asymmetrical 2009c (Fonov et al. 2009/2011), © 1993–2004 Louis Collins, McConnell Brain Imaging Centre, MNI, McGill University; via TemplateFlow.",
};

export async function fetchNifti(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Vorlage konnte nicht geladen werden (${res.status}).`);
  let buffer = await res.arrayBuffer();
  // Servers may already have decoded the gzip transfer (Content-Encoding): check the magic bytes.
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) buffer = await decompressGzip(buffer);
  return parseNifti1(buffer);
}

/** Loads the bundled MNI ICBM 2009c T1 template (2 mm) with its brain mask. */
export async function loadBundledMni(): Promise<LoadedDataset> {
  const [t1, mask] = await Promise.all([fetchNifti(BUNDLED_MNI.t1), fetchNifti(BUNDLED_MNI.mask)]);
  const dataset = createDataset(t1.volume, { kind: "nifti", fileName: "MNI152NLin2009cAsym_res-02_T1w.nii.gz", nifti: t1.nifti }, BUNDLED_MNI.name);
  const m = mask.volume.data;
  const binary = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) binary[i] = m[i] > 0.5 ? 1 : 0;
  return { ...dataset, template: { name: BUNDLED_MNI.name, kind: "T1", mask: binary, attribution: BUNDLED_MNI.attribution } };
}

/**
 * Own PET template from a NIfTI file. A 4D file is an adaptive template: volume 1 is the base (e.g. mean of
 * amyloid-negative scans), every further volume another template image (e.g. mean of amyloid-positive
 * scans), used as component (volume − base). A brain mask is derived from the base (> 20 % of its
 * 99th percentile).
 */
export async function loadPetTemplate(file: File): Promise<LoadedDataset> {
  let buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) buffer = await decompressGzip(buffer);
  const all = readNiftiAll(buffer);
  const [nx, ny, nz] = all.dims;
  const nvox = nx * ny * nz;
  const volumes = Math.max(1, Math.floor(all.data.length / nvox));
  const base = all.data.slice(0, nvox);
  const g = all.geometry;
  const vol = new Volume3D(base, nz, ny, nx, [g.spacing[2], g.spacing[1], g.spacing[0]], g);
  const components: Float32Array[] = [];
  for (let v = 1; v < volumes; v++) {
    const c = new Float32Array(nvox);
    for (let i = 0; i < nvox; i++) c[i] = all.data[v * nvox + i] - base[i];
    components.push(c);
  }
  const sorted = Float32Array.from(base.filter((x) => x > 0)).sort();
  const thr = 0.2 * (sorted[Math.floor(0.99 * (sorted.length - 1))] ?? 1);
  const mask = Float32Array.from(base, (x) => (x > thr ? 1 : 0));
  const name = file.name.replace(/\.nii(\.gz)?$/i, "");
  const nifti = parseNifti1(buffer).nifti;
  const d = createDataset(vol, { kind: "nifti", fileName: file.name, nifti }, name);
  return { ...d, template: { name: components.length ? `${name} (adaptiv, ${components.length + 1} Komponenten)` : name, kind: "PET", mask, components } };
}
