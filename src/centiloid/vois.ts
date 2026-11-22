import { voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { listZip } from "../core/unzip";
import type { Volume3D } from "../viewer/volume";
import { decompressGzip, parseNifti1 } from "../viewer/volumeLoader";

import { t, tk } from "../i18n";
/**
 * Standard Centiloid VOIs (Klunk et al. 2015, GAAIN): cortical target region and reference regions in
 * MNI space (SPM8 avg152T1, 1 or 2 mm). They overlap (CerebGry ⊂ WhlCbl ⊂ WhlCblBrnStm), so each is
 * kept as its own binary mask. The files are not distributed with the app (GAAIN terms of use) – the user
 * loads Centiloid_Std_VOI.zip or the NIfTI masks.
 */
export const VOI_NAMES = ["ctx", "WhlCbl", "CerebGry", "WhlCblBrnStm", "Pons"] as const;
export type VoiName = (typeof VOI_NAMES)[number];

export const VOI_LABELS: Record<VoiName, string> = {
  ctx: tk("Kortex (Ziel-VOI)"),
  WhlCbl: tk("Kleinhirn gesamt"),
  CerebGry: tk("Kleinhirnrinde"),
  WhlCblBrnStm: tk("Kleinhirn + Hirnstamm"),
  Pons: "Pons",
};

export interface CentiloidVois {
  /** Voxel size of the masks (mm). */
  resolutionMm: number;
  /** Geometry carrier of each mask (same grid for all masks of one set). */
  volumes: Partial<Record<VoiName, Volume3D>>;
  source: string;
}

export class VoiError extends Error {}

/** VOI name from a GAAIN file name such as "voi_WhlCblBrnStm_2mm.nii". */
export function voiNameFromFile(fileName: string): { name: VoiName; mm: number } | null {
  const m = /voi_(ctx|whlcblbrnstm|whlcbl|cerebgry|pons)_(\d)mm\.nii(\.gz)?$/i.exec(fileName.split("/").pop() ?? "");
  if (!m) return null;
  const name = VOI_NAMES.find((n) => n.toLowerCase() === m[1].toLowerCase())!;
  return { name, mm: Number(m[2]) };
}

async function niftiVolume(bytes: Uint8Array<ArrayBuffer>, fileName: string): Promise<Volume3D> {
  let buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) buffer = await decompressGzip(buffer);
  try {
    return parseNifti1(buffer).volume;
  } catch (e) {
    throw new VoiError(`${fileName}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Loads the VOIs from Centiloid_Std_VOI.zip and/or individual NIfTI masks. With both resolutions present,
 * `preferMm` (default 2 mm, the resolution of the SPM8 template) is used.
 */
export async function loadVois(files: { name: string; bytes: Uint8Array<ArrayBuffer> }[], preferMm = 2): Promise<CentiloidVois> {
  const candidates: { name: VoiName; mm: number; file: string; read: () => Promise<Uint8Array<ArrayBuffer>> }[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const buf = f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer;
      for (const e of listZip(buf)) {
        if (e.name.includes("__MACOSX")) continue;
        const id = voiNameFromFile(e.name);
        if (id) candidates.push({ ...id, file: e.name, read: e.read });
      }
    } else {
      const id = voiNameFromFile(f.name);
      if (id) candidates.push({ ...id, file: f.name, read: async () => f.bytes });
    }
  }
  if (!candidates.length) throw new VoiError(t("Keine Centiloid-VOIs gefunden (erwartet: Centiloid_Std_VOI.zip oder voi_*_2mm.nii)."));
  const resolutions = [...new Set(candidates.map((c) => c.mm))];
  const mm = resolutions.includes(preferMm) ? preferMm : resolutions[0];
  const volumes: Partial<Record<VoiName, Volume3D>> = {};
  for (const c of candidates.filter((x) => x.mm === mm)) volumes[c.name] = await niftiVolume(await c.read(), c.file);
  if (!volumes.ctx) throw new VoiError(t("Die Kortex-VOI (voi_ctx) fehlt."));
  if (!volumes.WhlCbl && !volumes.CerebGry && !volumes.WhlCblBrnStm && !volumes.Pons) throw new VoiError(t("Keine Referenz-VOI gefunden."));
  return { resolutionMm: mm, volumes, source: files.map((f) => f.name).join(", ") };
}

export interface VoiMean {
  name: VoiName;
  mean: number;
  voxels: number;
  volumeMl: number;
}

/**
 * Mean of `target` (a dataset in MNI space; its own geometry gives the MNI coordinates) inside each VOI.
 * Each target voxel takes the mask value of the nearest VOI voxel (> 0.5 = inside); NaN values are skipped.
 */
export function voiMeans(target: Volume3D, vois: CentiloidVois): VoiMean[] {
  const out: VoiMean[] = [];
  const voxelMl = (target.geometry.spacing[0] * target.geometry.spacing[1] * target.geometry.spacing[2]) / 1000;
  for (const name of VOI_NAMES) {
    const mask = vois.volumes[name];
    if (!mask) continue;
    const { m, origin } = worldToVoxelTransform(mask.geometry);
    let sum = 0, n = 0;
    for (let k = 0, o = 0; k < target.nz; k++)
      for (let j = 0; j < target.ny; j++)
        for (let i = 0; i < target.nx; i++, o++) {
          const v = target.data[o];
          if (!Number.isFinite(v)) continue;
          const p = voxelToWorld(target.geometry, i, j, k);
          const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
          const x = Math.round(m[0] * dx + m[1] * dy + m[2] * dz);
          const y = Math.round(m[3] * dx + m[4] * dy + m[5] * dz);
          const z = Math.round(m[6] * dx + m[7] * dy + m[8] * dz);
          if (x < 0 || y < 0 || z < 0 || x >= mask.nx || y >= mask.ny || z >= mask.nz) continue;
          if (!(mask.data[(z * mask.ny + y) * mask.nx + x] > 0.5)) continue;
          sum += v;
          n++;
        }
    out.push({ name, mean: n ? sum / n : NaN, voxels: n, volumeMl: n * voxelMl });
  }
  return out;
}

/** Number of mask voxels and their volume (ml) on the VOI's own grid. */
export function voiVolumeMl(mask: Volume3D): number {
  let n = 0;
  for (const v of mask.data) if (v > 0.5) n++;
  const s = mask.geometry.spacing;
  return (n * s[0] * s[1] * s[2]) / 1000;
}
