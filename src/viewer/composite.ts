import { type ColorLut, lutTable } from "./volume";

export interface CompositeLayer {
  values: Float32Array;
  window: [number, number];
  lut: ColorLut;
  /** 0..1; the bottom layer is always drawn opaque where it has data. */
  opacity: number;
}

/**
 * Blends layers (bottom → top) into RGBA. The bottom layer is opaque wherever it has data; upper
 * layers are blended with their opacity and are transparent at or below their window minimum
 * (so e.g. PET background does not cover the CT). NaN (outside a volume) is always transparent.
 */
export function compositeLayers(layers: CompositeLayer[], pixelCount: number, out?: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const rgba = (out && out.length === pixelCount * 4 ? out : new Uint8ClampedArray(pixelCount * 4)) as Uint8ClampedArray<ArrayBuffer>;
  rgba.fill(0);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; // black, opaque background
  layers.forEach((layer, index) => {
    const table = lutTable(layer.lut);
    const [lo, hi] = layer.window;
    const range = Math.max(hi - lo, 1e-12);
    const base = index === 0;
    const alpha = base ? 1 : Math.min(1, Math.max(0, layer.opacity));
    if (alpha === 0) return;
    const { values } = layer;
    for (let i = 0; i < pixelCount; i++) {
      const v = values[i];
      if (v !== v) continue; // NaN
      if (!base && v <= lo) continue;
      let t = (v - lo) / range;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const c = Math.round(t * 255) * 3;
      const o = i * 4;
      if (alpha === 1) {
        rgba[o] = table[c];
        rgba[o + 1] = table[c + 1];
        rgba[o + 2] = table[c + 2];
      } else {
        rgba[o] += (table[c] - rgba[o]) * alpha;
        rgba[o + 1] += (table[c + 1] - rgba[o + 1]) * alpha;
        rgba[o + 2] += (table[c + 2] - rgba[o + 2]) * alpha;
      }
    }
  });
  return rgba;
}
