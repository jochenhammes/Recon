import { type Vec3, add, scale, voxelToWorld } from "../core/geometry";
import { Volume3D, bilinearSample } from "./volume";

const MAX_IN_PLANE = 160;
const MAX_SLICES = 400;
const cache = new WeakMap<Volume3D, Volume3D>();

/**
 * Max-pooled copy of a volume small enough for interactive rotating MIPs (whole-body PET has
 * ~65 M voxels; ray-marching that per angle would take seconds). Returns the volume itself if small.
 */
export function mipSource(vol: Volume3D): Volume3D {
  const cached = cache.get(vol);
  if (cached) return cached;
  const fx = Math.ceil(vol.nx / MAX_IN_PLANE);
  const fy = Math.ceil(vol.ny / MAX_IN_PLANE);
  const fz = Math.ceil(vol.nz / MAX_SLICES);
  if (fx === 1 && fy === 1 && fz === 1) {
    cache.set(vol, vol);
    return vol;
  }
  const nx = Math.ceil(vol.nx / fx);
  const ny = Math.ceil(vol.ny / fy);
  const nz = Math.ceil(vol.nz / fz);
  const out = new Float32Array(nx * ny * nz).fill(-Infinity);
  const { data } = vol;
  for (let z = 0; z < vol.nz; z++) {
    const oz = Math.floor(z / fz) * ny * nx;
    for (let y = 0; y < vol.ny; y++) {
      const oy = oz + Math.floor(y / fy) * nx;
      const src = (z * vol.ny + y) * vol.nx;
      for (let x = 0; x < vol.nx; x++) {
        const v = data[src + x];
        const o = oy + Math.floor(x / fx);
        if (v > out[o]) out[o] = v;
      }
    }
  }
  const g = vol.geometry;
  const [sx, sy, sz] = g.spacing;
  const origin = add(
    add(add(g.origin, scale(g.axes[0], (sx * (fx - 1)) / 2)), scale(g.axes[1], (sy * (fy - 1)) / 2)),
    scale(g.axes[2], (sz * (fz - 1)) / 2),
  );
  const pooled = new Volume3D(out, nz, ny, nx, [sz * fz, sy * fy, sx * fx], {
    ...g,
    origin,
    spacing: [sx * fx, sy * fy, sz * fz],
  });
  cache.set(vol, pooled);
  return pooled;
}

/**
 * Rotating MIP oriented for display: head up and, at 0°, an anterior view with the patient's right
 * on the image left (index axes are flipped according to the geometry).
 */
export function orientedMip(vol: Volume3D, azimuthDeg: number): { data: Float32Array; width: number; height: number; pixelAspect: number } {
  const src = mipSource(vol);
  const mip = src.rotatingMip(azimuthDeg);
  const { width, height } = mip;
  const flipV = src.geometry.axes[2][2] > 0; // slice index grows towards the head → put last slice on top
  const flipH = src.geometry.axes[0][0] < 0;
  let data = mip.data;
  if (flipV || flipH) {
    data = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      const sr = flipV ? height - 1 - r : r;
      for (let c = 0; c < width; c++) data[r * width + c] = mip.data[sr * width + (flipH ? width - 1 - c : c)];
    }
  }
  const [sx, , sz] = src.geometry.spacing;
  return { data, width, height, pixelAspect: sz / sx };
}

/**
 * Point behind a click in the rotating MIP: image column/row (pixel centres of the oriented image, as from
 * `orientedMip` or the GPU path) → the voxel with the maximum along that ray. Returns the patient (native world)
 * coordinate of that voxel, so the viewer can jump to its axial slice and position; null outside the image.
 */
export function mipPick(vol: Volume3D, azimuthDeg: number, u: number, v: number): Vec3 | null {
  const src = mipSource(vol);
  const width = Math.max(src.nx, src.ny), height = src.nz;
  const col = Math.round(u), row = Math.round(v);
  if (col < 0 || row < 0 || col >= width || row >= height) return null;
  const flipV = src.geometry.axes[2][2] > 0;
  const flipH = src.geometry.axes[0][0] < 0;
  const z = flipV ? height - 1 - row : row;
  const ui = flipH ? width - 1 - col : col;
  // Same ray as Volume3D.rotatingMip.
  const theta = (azimuthDeg * Math.PI) / 180;
  const viewX = Math.sin(theta), viewY = Math.cos(theta), uX = Math.cos(theta), uY = -Math.sin(theta);
  const cx = (src.nx - 1) / 2, cy = (src.ny - 1) / 2;
  const radius = Math.sqrt(cx * cx + cy * cy) + 1;
  const uu = ((ui - (width - 1) / 2) / Math.max(1, width - 1)) * (radius * 2);
  const steps = Math.ceil(radius * 2);
  const base = z * src.ny * src.nx;
  let best = -Infinity, bx = cx + uu * uX, by = cy + uu * uY;
  for (let s = 0; s <= steps; s++) {
    const t = -radius + (2 * radius * s) / steps;
    const x = cx + uu * uX + t * viewX, y = cy + uu * uY + t * viewY;
    const val = bilinearSample(src.data, base, src.nx, src.ny, x, y);
    if (val > best) {
      best = val;
      bx = x;
      by = y;
    }
  }
  // No activity along the ray: the middle of the ray (keeps the axial slice of the click without jumping to an edge).
  if (!(best > 0)) {
    bx = cx + uu * uX;
    by = cy + uu * uY;
  }
  return voxelToWorld(src.geometry, bx, by, z);
}
