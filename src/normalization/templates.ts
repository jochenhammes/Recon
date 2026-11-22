import type { LoadedDataset } from "../dataset/types";
import { createDataset } from "../dataset/types";
import { Volume3D } from "../viewer/volume";
import { decompressGzip, parseNifti1, readNiftiAll } from "../viewer/volumeLoader";

import { t, tk } from "../i18n";
/** Marks a dataset as a standard-space template. */
/** Contrast of a template: T1 MRI, tracer PET/SPECT or CT-like (attenuation). */
export type TemplateKind = "T1" | "PET" | "CT";

export interface TemplateInfo {
  name: string;
  /** Contrast of the template (T1 MRI or tracer PET); decides the default cost function. */
  kind: TemplateKind;
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
  if (!res.ok) throw new Error(t("Vorlage konnte nicht geladen werden ({status}).", { status: res.status }));
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
  return { ...dataset, catalogId: "mni-t1-2", template: { name: BUNDLED_MNI.name, kind: "T1", mask: binary, attribution: BUNDLED_MNI.attribution } };
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
  const mask = maskFromBase(base);
  const name = file.name.replace(/\.nii(\.gz)?$/i, "");
  const nifti = parseNifti1(buffer).nifti;
  const d = createDataset(vol, { kind: "nifti", fileName: file.name, nifti }, name);
  return { ...d, template: { name: components.length ? t("{name} (adaptiv, {v} Komponenten)", { name, v: components.length + 1 }) : name, kind: "PET", mask, components } };
}

/** Brain mask of a PET/SPECT template: voxels above 20 % of the 99th percentile. */
export function maskFromBase(base: Float32Array): Float32Array {
  const sorted = Float32Array.from(base.filter((x) => x > 0)).sort();
  const thr = 0.2 * (sorted[Math.floor(0.99 * (sorted.length - 1))] ?? 1);
  return Float32Array.from(base, (x) => (x > thr ? 1 : 0));
}

/** PET/SPECT/transmission templates bundled from SPM12 (toolbox/OldNorm, GPL v2+), MNI space 2 mm (91×109×91). */
export const BUNDLED_PET_TEMPLATES = [
  {
    id: "spm-pet",
    name: "SPM12 PET (H₂¹⁵O-Perfusion, 2 mm)",
    file: `${BASE}spm12_PET.nii.gz`,
    hint: tk("für Hirn-PET ohne MRT (Perfusion, näherungsweise auch FDG)"),
    kind: "PET",
  },
  {
    id: "spm-spect",
    name: "SPM12 SPECT (Perfusion, 2 mm)",
    file: `${BASE}spm12_SPECT.nii.gz`,
    hint: tk("für Hirnperfusions-SPECT (HMPAO/ECD)"),
    kind: "PET",
  },
  {
    id: "spm-transm",
    name: tk("SPM12 Transmission (CT-ähnlich, 2 mm)"),
    file: `${BASE}spm12_Transm.nii.gz`,
    hint: tk("für das Kopf-CT (z. B. aus PET/CT): Schwächungsbild mit hellem Knochen"),
    kind: "CT",
  },
] as const;

export const SPM_TEMPLATE_LICENSE = `${BASE}LICENSE-SPM12-GPL.txt`;
export const SPM_TEMPLATE_ATTRIBUTION = tk("SPM12 (Wellcome Centre for Human Neuroimaging, UCL), toolbox/OldNorm, GNU General Public License v2 oder später.");

export async function loadBundledPetTemplate(id: (typeof BUNDLED_PET_TEMPLATES)[number]["id"]): Promise<LoadedDataset> {
  const t = BUNDLED_PET_TEMPLATES.find((x) => x.id === id)!;
  const img = await fetchNifti(t.file);
  const d = createDataset(img.volume, { kind: "nifti", fileName: t.file.split("/").pop()!, nifti: img.nifti }, t.name);
  // The transmission template is matched as a whole head (bone carries the information): no brain mask.
  return { ...d, catalogId: t.id, template: { name: t.name, kind: t.kind, mask: t.kind === "CT" ? null : maskFromBase(img.volume.data), attribution: SPM_TEMPLATE_ATTRIBUTION } };
}

/**
 * Template for the estimation on a coarser grid: block average over f×f×f voxels (f = round(2 mm / spacing), e.g. 2
 * for a 1 mm template), so a 1 mm template is matched at 2 mm (same speed as before); the mask is averaged and
 * thresholded at 0.5. Templates of 1.5 mm or coarser are returned unchanged.
 */
export function coarseTemplate(v: Volume3D, mask?: Float32Array | null): { volume: Volume3D; mask?: Float32Array | null } {
  const f = Math.round(2 / Math.max(...v.geometry.spacing));
  if (f < 2) return { volume: v, mask };
  const nx = Math.floor(v.nx / f), ny = Math.floor(v.ny / f), nz = Math.floor(v.nz / f);
  const avg = (src: Float32Array) => {
    const out = new Float32Array(nx * ny * nz);
    const n = f * f * f;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let s = 0;
          for (let c = 0; c < f; c++)
            for (let b = 0; b < f; b++) {
              const row = ((k * f + c) * v.ny + j * f + b) * v.nx + i * f;
              for (let a = 0; a < f; a++) s += src[row + a];
            }
          out[(k * ny + j) * nx + i] = s / n;
        }
    return out;
  };
  const g = v.geometry;
  // Centre of the new voxel (0,0,0) = centre of the old block.
  const shift = (f - 1) / 2;
  const origin = [0, 1, 2].map((d) => g.origin[d] + g.axes[0][d] * g.spacing[0] * shift + g.axes[1][d] * g.spacing[1] * shift + g.axes[2][d] * g.spacing[2] * shift) as [number, number, number];
  const geometry = { ...g, origin, spacing: [g.spacing[0] * f, g.spacing[1] * f, g.spacing[2] * f] as [number, number, number] };
  const volume = new Volume3D(avg(v.data), nz, ny, nx, [geometry.spacing[2], geometry.spacing[1], geometry.spacing[0]], geometry);
  return { volume, mask: mask ? Float32Array.from(avg(mask), (x) => (x >= 0.5 ? 1 : 0)) : mask };
}
