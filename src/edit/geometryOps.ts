import { type Vec3, type VolumeGeometry, add, scale, voxelToWorld } from "../core/geometry";
import { Volume3D } from "../viewer/volume";

/** Keeps voxels [min, max] (inclusive, index space); anatomy stays in place. */
export function cropVolume(volume: Volume3D, min: Vec3, max: Vec3): Volume3D {
  const dims = [volume.nx, volume.ny, volume.nz];
  const lo = min.map((v, a) => Math.max(0, Math.min(dims[a] - 1, Math.round(v))));
  const hi = max.map((v, a) => Math.max(lo[a], Math.min(dims[a] - 1, Math.round(v))));
  const [nx, ny, nz] = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const out = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      const src = ((k + lo[2]) * volume.ny + (j + lo[1])) * volume.nx + lo[0];
      out.set(volume.data.subarray(src, src + nx), (k * ny + j) * nx);
    }
  const g: VolumeGeometry = { ...volume.geometry, origin: voxelToWorld(volume.geometry, lo[0], lo[1], lo[2]) };
  return new Volume3D(out, nz, ny, nx, volume.voxelSpacingMm, g);
}

/** Mirrors the image content along an index axis (x = left/right for axial data); geometry unchanged. */
export function flipVolume(volume: Volume3D, axis: 0 | 1 | 2): Volume3D {
  const { nx, ny, nz, data } = volume;
  const out = new Float32Array(data.length);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const si = axis === 0 ? nx - 1 - i : i;
        const sj = axis === 1 ? ny - 1 - j : j;
        const sk = axis === 2 ? nz - 1 - k : k;
        out[(k * ny + j) * nx + i] = data[(sk * ny + sj) * nx + si];
      }
  return volume.withData(out);
}

/**
 * Rotates the image content in the slice plane by `turns` × 90° clockwise (as seen in the axial view
 * of axis-aligned data) about the volume center.
 */
export function rotateVolume90(volume: Volume3D, turns: number): Volume3D {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return volume;
  const { nx, ny, nz, data } = volume;
  const odd = t % 2 === 1;
  const [mx, my] = odd ? [ny, nx] : [nx, ny];
  const out = new Float32Array(data.length);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < my; j++)
      for (let i = 0; i < mx; i++) {
        // Source pixel for output (i, j) for a clockwise rotation by t quarter turns.
        let si: number, sj: number;
        if (t === 1) [si, sj] = [j, ny - 1 - i];
        else if (t === 2) [si, sj] = [nx - 1 - i, ny - 1 - j];
        else [si, sj] = [nx - 1 - j, i];
        out[(k * my + j) * mx + i] = data[(k * ny + sj) * nx + si];
      }
  const g = volume.geometry;
  const [sx, sy, sz] = g.spacing;
  const spacing: Vec3 = odd ? [sy, sx, sz] : [sx, sy, sz];
  const center = voxelToWorld(g, (nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2);
  const origin = add(
    add(add(center, scale(g.axes[0], (-spacing[0] * (mx - 1)) / 2)), scale(g.axes[1], (-spacing[1] * (my - 1)) / 2)),
    scale(g.axes[2], (-spacing[2] * (nz - 1)) / 2),
  );
  return new Volume3D(out, nz, my, mx, [spacing[2], spacing[1], spacing[0]], { ...g, origin, spacing });
}

/** Resamples to a new voxel size (mm) with trilinear interpolation, keeping the volume's outer extent. */
export function resampleVolume(volume: Volume3D, spacing: Vec3): Volume3D {
  const g = volume.geometry;
  const oldDims = [volume.nx, volume.ny, volume.nz];
  const newDims = oldDims.map((n, a) => Math.max(1, Math.round((n * g.spacing[a]) / spacing[a])));
  let buf = volume.data;
  let dims = [...oldDims];
  for (let axis = 0; axis < 3; axis++) {
    if (newDims[axis] === dims[axis] && spacing[axis] === g.spacing[axis]) continue;
    buf = resampleAxis(buf, dims, axis, newDims[axis], g.spacing[axis], spacing[axis]);
    dims = dims.map((d, a) => (a === axis ? newDims[axis] : d));
  }
  // Align outer edges: the first new voxel center sits half a new voxel inside the old edge.
  let origin = g.origin;
  for (let a = 0; a < 3; a++) origin = add(origin, scale(g.axes[a], (spacing[a] - g.spacing[a]) / 2));
  return new Volume3D(buf === volume.data ? Float32Array.from(buf) : buf, dims[2], dims[1], dims[0], [spacing[2], spacing[1], spacing[0]], {
    ...g,
    origin,
    spacing: [...spacing] as Vec3,
  });
}

function resampleAxis(src: Float32Array, dims: number[], axis: number, n: number, oldSpacing: number, newSpacing: number): Float32Array {
  const outDims = dims.map((d, a) => (a === axis ? n : d));
  const out = new Float32Array(outDims[0] * outDims[1] * outDims[2]);
  const inStride = [1, dims[0], dims[0] * dims[1]];
  const outStride = [1, outDims[0], outDims[0] * outDims[1]];
  const [a1, a2] = [0, 1, 2].filter((a) => a !== axis);
  const m = dims[axis];
  // Position of new sample i in old index units.
  const pos = new Float64Array(n);
  for (let i = 0; i < n; i++) pos[i] = ((i + 0.5) * newSpacing) / oldSpacing - 0.5;
  const ratio = newSpacing / oldSpacing;
  const downsample = ratio > 1.01;
  for (let p = 0; p < dims[a2]; p++)
    for (let q = 0; q < dims[a1]; q++) {
      const inBase = p * inStride[a2] + q * inStride[a1];
      const outBase = p * outStride[a2] + q * outStride[a1];
      if (downsample) {
        // Area-weighted average over the old voxels covered by each new voxel (old edges at j, j+1).
        for (let i = 0; i < n; i++) {
          const e0 = i * ratio;
          const e1 = Math.min(m, (i + 1) * ratio);
          let s = 0;
          let w = 0;
          for (let j = Math.floor(e0); j < Math.min(m, Math.ceil(e1)); j++) {
            const overlap = Math.min(e1, j + 1) - Math.max(e0, j);
            if (overlap <= 0) continue;
            s += src[inBase + j * inStride[axis]] * overlap;
            w += overlap;
          }
          out[outBase + i * outStride[axis]] = w > 0 ? s / w : src[inBase + (m - 1) * inStride[axis]];
        }
        continue;
      }
      for (let i = 0; i < n; i++) {
        const x = Math.min(m - 1, Math.max(0, pos[i]));
        const x0 = Math.floor(x);
        const x1 = Math.min(m - 1, x0 + 1);
        const f = x - x0;
        const v0 = src[inBase + x0 * inStride[axis]];
        const v1 = src[inBase + x1 * inStride[axis]];
        out[outBase + i * outStride[axis]] = v0 + (v1 - v0) * f;
      }
    }
  return out;
}
