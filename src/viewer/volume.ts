/** Reconstructed 3D volume, slice-major: data[(z * ny + y) * nx + x]. */
export class Volume3D {
  readonly nz: number;
  readonly ny: number;
  readonly nx: number;
  readonly data: Float32Array;
  readonly voxelSpacingMm: [number, number, number];

  constructor(data: Float32Array, nz: number, ny: number, nx: number, voxelSpacingMm: [number, number, number]) {
    if (data.length !== nz * ny * nx) throw new Error("Volume3D: data length mismatch");
    this.data = data;
    this.nz = nz;
    this.ny = ny;
    this.nx = nx;
    this.voxelSpacingMm = voxelSpacingMm;
  }

  get(z: number, y: number, x: number): number {
    return this.data[(z * this.ny + y) * this.nx + x];
  }

  /** Transaxial slice at fixed z. Returns ny x nx, row-major. */
  axialSlice(z: number): { width: number; height: number; data: Float32Array } {
    const zc = clamp(z, 0, this.nz - 1);
    const size = this.ny * this.nx;
    return { width: this.nx, height: this.ny, data: this.data.subarray(zc * size, zc * size + size) };
  }

  /** Sagittal slice at fixed x (varies z vertically, y horizontally). Returns ny x nz. */
  sagittalSlice(x: number): { width: number; height: number; data: Float32Array } {
    const xc = clamp(x, 0, this.nx - 1);
    const out = new Float32Array(this.nz * this.ny);
    for (let z = 0; z < this.nz; z++) {
      const rowBase = (z * this.ny) * this.nx;
      for (let y = 0; y < this.ny; y++) {
        out[z * this.ny + y] = this.data[rowBase + y * this.nx + xc];
      }
    }
    return { width: this.ny, height: this.nz, data: out };
  }

  /** Coronal slice at fixed y (varies z vertically, x horizontally). Returns nx x nz. */
  coronalSlice(y: number): { width: number; height: number; data: Float32Array } {
    const yc = clamp(y, 0, this.ny - 1);
    const out = new Float32Array(this.nz * this.nx);
    for (let z = 0; z < this.nz; z++) {
      const base = (z * this.ny + yc) * this.nx;
      for (let x = 0; x < this.nx; x++) {
        out[z * this.nx + x] = this.data[base + x];
      }
    }
    return { width: this.nx, height: this.nz, data: out };
  }

  /**
   * Rotating maximum-intensity projection around the vertical (z) axis, viewed from azimuth
   * `azimuthDeg` (0 = looking along +y, matching the default coronal/anterior view).
   */
  rotatingMip(azimuthDeg: number, outWidth?: number): { width: number; height: number; data: Float32Array } {
    const theta = (azimuthDeg * Math.PI) / 180;
    // View direction (ray marching axis) and in-plane output axis, both in the xy plane.
    const viewX = Math.sin(theta);
    const viewY = Math.cos(theta);
    const uX = Math.cos(theta);
    const uY = -Math.sin(theta);

    const cx = (this.nx - 1) / 2;
    const cy = (this.ny - 1) / 2;
    const radius = Math.sqrt(cx * cx + cy * cy) + 1;
    const width = outWidth ?? Math.max(this.nx, this.ny);
    const height = this.nz;
    const out = new Float32Array(width * height);
    const numSteps = Math.ceil(radius * 2);

    for (let z = 0; z < this.nz; z++) {
      const sliceBase = z * this.ny * this.nx;
      const rowOut = z * width;
      for (let ui = 0; ui < width; ui++) {
        const u = ((ui - (width - 1) / 2) / (width - 1)) * (radius * 2);
        let maxVal = 0;
        for (let s = 0; s <= numSteps; s++) {
          const v = -radius + (2 * radius * s) / numSteps;
          const x = cx + u * uX + v * viewX;
          const y = cy + u * uY + v * viewY;
          const val = bilinearSample(this.data, sliceBase, this.nx, this.ny, x, y);
          if (val > maxVal) maxVal = val;
        }
        out[rowOut + ui] = maxVal;
      }
    }
    return { width, height, data: out };
  }

  percentile(p: number): number {
    const sorted = Float32Array.from(this.data).sort();
    const idx = clamp(Math.floor((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
    return sorted[idx];
  }

  max(): number {
    let m = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > m) m = this.data[i];
    return m;
  }
}

function bilinearSample(data: Float32Array, sliceBase: number, nx: number, ny: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > nx - 1 || y > ny - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, nx - 1);
  const y1 = Math.min(y0 + 1, ny - 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = data[sliceBase + y0 * nx + x0];
  const v10 = data[sliceBase + y0 * nx + x1];
  const v01 = data[sliceBase + y1 * nx + x0];
  const v11 = data[sliceBase + y1 * nx + x1];
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type ColorLut = "gray" | "inverted" | "rainbow" | "kidney";

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  let r1 = 0, g1 = 0, b1 = 0;
  const sector = Math.floor(hp) % 6;
  if (sector === 0) { r1 = c; g1 = x; }
  else if (sector === 1) { r1 = x; g1 = c; }
  else if (sector === 2) { g1 = c; b1 = x; }
  else if (sector === 3) { g1 = x; b1 = c; }
  else if (sector === 4) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function buildRainbowLut(): Uint8Array {
  const t = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const h = ((255 - i) / 255) * 240;
    const [r, g, b] = hsvToRgb(h, 1, 1);
    t[i * 3] = r; t[i * 3 + 1] = g; t[i * 3 + 2] = b;
  }
  return t;
}

function buildKidneyLut(): Uint8Array {
  // Hot-body: black → red → yellow → white.
  const stops: [number, number, number, number][] = [
    [0, 0, 0, 0], [85, 255, 0, 0], [170, 255, 255, 0], [255, 255, 255, 255],
  ];
  const t = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    let k = stops.length - 2;
    for (let s = 0; s < stops.length - 1; s++) {
      if (i <= stops[s + 1][0]) { k = s; break; }
    }
    const [v0, r0, g0, b0] = stops[k];
    const [v1, r1, g1, b1] = stops[k + 1];
    const tf = (i - v0) / (v1 - v0);
    t[i * 3] = Math.round(r0 + tf * (r1 - r0));
    t[i * 3 + 1] = Math.round(g0 + tf * (g1 - g0));
    t[i * 3 + 2] = Math.round(b0 + tf * (b1 - b0));
  }
  return t;
}

const RAINBOW_LUT = buildRainbowLut();
const KIDNEY_LUT = buildKidneyLut();

/** Maps a float slice buffer to RGBA (ImageData-ready) using window/level and an optional color LUT. */
export function windowLevelToRgba(
  slice: Float32Array,
  windowMin: number,
  windowMax: number,
  colorLut: ColorLut = "gray",
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(slice.length * 4);
  const range = Math.max(windowMax - windowMin, 1e-6);
  for (let i = 0; i < slice.length; i++) {
    const norm = clamp((slice[i] - windowMin) / range, 0, 1);
    const v = Math.round(norm * 255);
    const o = i * 4;
    if (colorLut === "inverted") {
      const iv = 255 - v;
      out[o] = iv; out[o + 1] = iv; out[o + 2] = iv;
    } else if (colorLut === "rainbow") {
      out[o] = RAINBOW_LUT[v * 3]; out[o + 1] = RAINBOW_LUT[v * 3 + 1]; out[o + 2] = RAINBOW_LUT[v * 3 + 2];
    } else if (colorLut === "kidney") {
      out[o] = KIDNEY_LUT[v * 3]; out[o + 1] = KIDNEY_LUT[v * 3 + 1]; out[o + 2] = KIDNEY_LUT[v * 3 + 2];
    } else {
      out[o] = v; out[o + 1] = v; out[o + 2] = v;
    }
    out[o + 3] = 255;
  }
  return out;
}
