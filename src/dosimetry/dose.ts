import { type Vec3, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { type Mat4, applyMat4, invert4, multiply4 } from "../core/transform";
import type { Volume3D } from "../viewer/volume";

/** A volume placed in the reference world (native → reference matrix). */
export interface Placed {
  volume: Volume3D;
  matrix: Mat4;
}

/** Trilinear sample of a volume at continuous voxel coordinates (0 outside). */
export function trilinear(v: Volume3D, x: number, y: number, z: number): number {
  const { nx, ny, nz, data } = v;
  if (x < -0.5 || y < -0.5 || z < -0.5 || x > nx - 0.5 || y > ny - 0.5 || z > nz - 0.5) return 0;
  const cx = Math.min(Math.max(x, 0), nx - 1), cy = Math.min(Math.max(y, 0), ny - 1), cz = Math.min(Math.max(z, 0), nz - 1);
  const x0 = Math.floor(cx), y0 = Math.floor(cy), z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), z1 = Math.min(z0 + 1, nz - 1);
  const fx = cx - x0, fy = cy - y0, fz = cz - z0;
  const at = (i: number, j: number, k: number) => data[(k * ny + j) * nx + i];
  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx;
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx;
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
  return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
}

/** Affine map voxel of `from` → continuous voxel of `to`, both placed in the reference world. */
export function voxelMap(from: Placed, to: Placed): (i: number, j: number, k: number) => Vec3 {
  const toNative = invert4(to.matrix);
  const M = multiply4(toNative, from.matrix);
  const w2v = worldToVoxelTransform(to.volume.geometry);
  const g = from.volume.geometry;
  // Linear in (i, j, k): precompute origin and the three axis steps.
  const conv = (p: Vec3): Vec3 => {
    const q = applyMat4(M, p);
    const x = q[0] - w2v.origin[0], y = q[1] - w2v.origin[1], z = q[2] - w2v.origin[2];
    const m = w2v.m;
    return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
  };
  const o = conv(voxelToWorld(g, 0, 0, 0));
  const ax = [conv(voxelToWorld(g, 1, 0, 0)), conv(voxelToWorld(g, 0, 1, 0)), conv(voxelToWorld(g, 0, 0, 1))].map((p) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
  return (i, j, k) => [
    o[0] + i * ax[0][0] + j * ax[1][0] + k * ax[2][0],
    o[1] + i * ax[0][1] + j * ax[1][1] + k * ax[2][1],
    o[2] + i * ax[0][2] + j * ax[1][2] + k * ax[2][2],
  ];
}

export const voxelMl = (v: Volume3D) => (v.geometry.spacing[0] * v.geometry.spacing[1] * v.geometry.spacing[2]) / 1000;

/** Mass density (g/ml) from CT Hounsfield units: 1 + HU/1000 below water, 1 + 0.6·HU/1000 above (bone-like). */
export function densityFromHu(hu: number): number {
  return hu <= 0 ? Math.max(0.001, 1 + hu / 1000) : 1 + (0.6 * hu) / 1000;
}

export interface RegionMeasure {
  label: number;
  voxels: number;
  volumeMl: number;
  massG: number;
  /** Activity in the region (MBq) at the time point. */
  activityMBq: number;
}

/**
 * Activity, volume and mass per label: the SPECT activity concentration (MBq/ml = counts × `mbqPerCount` /
 * SPECT voxel volume) is sampled at every label voxel and integrated over the label voxel volume; mass from
 * the CT density (or 1 g/ml without CT).
 */
export function measureRegions(labels: Placed, spect: Placed, mbqPerCount: number, ct?: Placed, only?: Set<number>): Map<number, RegionMeasure> {
  const lv = labels.volume;
  const toSpect = voxelMap(labels, spect);
  const toCt = ct ? voxelMap(labels, ct) : null;
  const concPerCount = mbqPerCount / voxelMl(spect.volume);
  const vml = voxelMl(lv);
  const out = new Map<number, RegionMeasure>();
  const { nx, ny, nz, data } = lv;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const lab = Math.round(data[(k * ny + j) * nx + i]);
        if (lab <= 0 || (only && !only.has(lab))) continue;
        let r = out.get(lab);
        if (!r) out.set(lab, (r = { label: lab, voxels: 0, volumeMl: 0, massG: 0, activityMBq: 0 }));
        const s = toSpect(i, j, k);
        r.voxels++;
        r.activityMBq += trilinear(spect.volume, s[0], s[1], s[2]) * concPerCount * vml;
        let rho = 1;
        if (toCt) {
          const c = toCt(i, j, k);
          rho = densityFromHu(trilinear(ct!.volume, c[0], c[1], c[2]));
        }
        r.massG += rho * vml;
      }
  for (const r of out.values()) r.volumeMl = r.voxels * vml;
  return out;
}
