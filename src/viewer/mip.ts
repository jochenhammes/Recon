import { add, scale } from "../core/geometry";
import { Volume3D } from "./volume";

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
