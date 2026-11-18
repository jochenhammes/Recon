import { quickselect } from "../analysis/stats";
import { type VolumeGeometry, identityGeometry } from "../core/geometry";

/**
 * 3D volume, slice-major: data[(z * ny + y) * nx + x], with its position in patient space.
 * Index axes: x = column, y = row, z = slice (see VolumeGeometry).
 */
export class Volume3D {
  readonly nz: number;
  readonly ny: number;
  readonly nx: number;
  readonly data: Float32Array;
  /** [spacingZ, spacingY, spacingX] in mm (kept for compatibility; mirrors geometry.spacing). */
  readonly voxelSpacingMm: [number, number, number];
  readonly geometry: VolumeGeometry;

  constructor(
    data: Float32Array,
    nz: number,
    ny: number,
    nx: number,
    voxelSpacingMm: [number, number, number],
    geometry?: VolumeGeometry,
  ) {
    if (data.length !== nz * ny * nx) throw new Error("Volume3D: data length mismatch");
    this.data = data;
    this.nz = nz;
    this.ny = ny;
    this.nx = nx;
    this.geometry = geometry ?? identityGeometry([voxelSpacingMm[2], voxelSpacingMm[1], voxelSpacingMm[0]]);
    const [sx, sy, sz] = this.geometry.spacing;
    this.voxelSpacingMm = [sz, sy, sx];
  }

  /** Same dimensions and geometry, new voxel data. */
  withData(data: Float32Array): Volume3D {
    return new Volume3D(data, this.nz, this.ny, this.nx, this.voxelSpacingMm, this.geometry);
  }

  /** True if patient-space coordinates are known (not just the identity fallback). */
  get hasPatientGeometry(): boolean {
    const g = this.geometry;
    return g.origin.some((v) => v !== 0) || g.axes[0][0] !== 1 || g.axes[1][1] !== 1 || g.axes[2][2] !== 1;
  }

  get(z: number, y: number, x: number): number {
    return this.data[(z * this.ny + y) * this.nx + x];
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
    // Selection instead of a full sort: O(n) on a copy (the selection reorders it).
    const copy = Float32Array.from(this.data);
    const idx = clamp(Math.floor((p / 100) * (copy.length - 1)), 0, copy.length - 1);
    return quickselect(copy, idx);
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

export type ColorLut = "gray" | "inverted" | "hot" | "dat" | "blue" | "diverging" | "rainbow" | "voi" | "labels";

/** Color tables offered in the UI (label and VOI tables are special-purpose). */
export const LUT_CHOICES: { value: ColorLut; label: string }[] = [
  { value: "gray", label: "Graustufen" },
  { value: "inverted", label: "Invertiert" },
  { value: "hot", label: "Hot (Schwarz–Rot–Gelb–Weiß)" },
  { value: "dat", label: "DaT (Schwarz–Grün–Gelb–Hellrot)" },
  { value: "blue", label: "Blau (Schwarz–Blau–Hellblau–Weiß)" },
  { value: "diverging", label: "Blau–Weiß–Rot (Z-Werte)" },
  { value: "rainbow", label: "Regenbogen" },
  { value: "labels", label: "Atlas-Regionen (Farbtabelle)" },
];

/** Old names: "kidney" was the hot-body table (project version 1), then briefly the DaT table (version 2). */
export function migrateLut(lut: string, savedVersion: number): ColorLut {
  if (lut === "kidney") return savedVersion < 2 ? "hot" : "dat";
  return lut as ColorLut;
}

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

/** Piecewise linear table from [index, r, g, b] stops. */
function buildStopsLut(stops: [number, number, number, number][]): Uint8Array {
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
// Hot body: black → red → yellow → white.
const HOT_LUT = buildStopsLut([[0, 0, 0, 0], [85, 255, 0, 0], [170, 255, 255, 0], [255, 255, 255, 255]]);
// DaT (typical DaTscan display): black → dark green → green → yellow → light red.
const DAT_LUT = buildStopsLut([[0, 0, 0, 0], [64, 0, 85, 10], [128, 20, 190, 40], [176, 170, 230, 20], [216, 255, 225, 30], [255, 255, 120, 100]]);
// Blue shades: black → dark blue → blue → light blue → white.
// Diverging (z-scores): dark blue → blue → white (middle) → red → dark red.
const DIVERGING_LUT = buildStopsLut([[0, 10, 20, 110], [64, 30, 90, 230], [128, 255, 255, 255], [192, 230, 60, 40], [255, 120, 0, 10]]);
const BLUE_LUT = buildStopsLut([[0, 0, 0, 0], [70, 0, 20, 110], [140, 20, 90, 230], [200, 110, 190, 255], [255, 235, 248, 255]]);
const GRAY_LUT = Uint8Array.from({ length: 256 * 3 }, (_, i) => Math.floor(i / 3));
const INVERTED_LUT = Uint8Array.from({ length: 256 * 3 }, (_, i) => 255 - Math.floor(i / 3));
/** Distinct colors for label atlases (index = label with window [0, 255]); golden-angle hues. */
const LABEL_LUT = (() => {
  const t = new Uint8Array(256 * 3);
  for (let i = 1; i < 256; i++) t.set(hsvToRgb((i * 137.508) % 360, i % 2 ? 0.75 : 0.55, i % 3 ? 1 : 0.8), i * 3);
  return t;
})();
const VOI_LUT = Uint8Array.from({ length: 256 * 3 }, (_, i) => [40, 230, 140][i % 3]);

/** 256-entry RGB table (r, g, b interleaved) for a color LUT. */
export function lutTable(lut: ColorLut): Uint8Array {
  switch (lut) {
    case "rainbow":
      return RAINBOW_LUT;
    case "hot":
      return HOT_LUT;
    case "dat":
      return DAT_LUT;
    case "blue":
      return BLUE_LUT;
    case "diverging":
      return DIVERGING_LUT;
    case "inverted":
      return INVERTED_LUT;
    case "voi":
      return VOI_LUT;
    case "labels":
      return LABEL_LUT;
    default:
      return GRAY_LUT;
  }
}

/** CSS linear-gradient of a color LUT (legend swatches); labels show a few distinct colors. */
export function lutGradient(lut: ColorLut): string {
  const t = lutTable(lut);
  const idx = lut === "labels" ? [1, 2, 3, 4, 5] : [0, 64, 128, 192, 255];
  const stops = idx.map((i, k) => `rgb(${t[i * 3]}, ${t[i * 3 + 1]}, ${t[i * 3 + 2]}) ${(k / (idx.length - 1)) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
