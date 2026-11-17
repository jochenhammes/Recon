import type { DicomPixelEncoding } from "../dataset/types";
import { formatDS } from "./dicomRewriter";

export interface EncodedPixels {
  /** Little-endian sample bytes for all frames of the file. */
  bytes: Uint8Array<ArrayBuffer>;
  encoding: DicomPixelEncoding;
  /** True if slope/intercept/bit depth differ from the original encoding. */
  rescaled: boolean;
  /**
   * True if the original encoding was kept but some values were off its quantization grid and were
   * rounded to the nearest representable value (error ≤ slope / 2, see maxError).
   */
  snapped: boolean;
  /** Largest absolute difference between a real value and its encoded representation. */
  maxError: number;
  /** Smallest/largest stored (pre-rescale) sample value actually written. */
  storedMin: number;
  storedMax: number;
}

/** Tolerance (in stored units) for accepting a value as exactly on the original quantization grid. */
const GRID_TOLERANCE = 1e-3;

function storedRange(bitsStored: number, pixelRepresentation: number): [number, number] {
  return pixelRepresentation === 1 ? [-(2 ** (bitsStored - 1)), 2 ** (bitsStored - 1) - 1] : [0, 2 ** bitsStored - 1];
}

/**
 * Encodes real voxel values for one DICOM file. The original encoding (bit depth, signedness,
 * slope, intercept) is kept whenever every value lies inside the stored range; unchanged voxels then
 * round-trip bit-exactly and values off the quantization grid (e.g. an edit's replacement value) are
 * rounded to the nearest grid value (`snapped`). Only if values exceed the stored range is a new
 * slope/intercept derived (8-bit data is widened to 16 bit) and `rescaled` set.
 */
export function encodePixels(values: Float32Array, original: DicomPixelEncoding): EncodedPixels {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) min = max = 0;

  const fit = fitsEncoding(values, original);
  if (fit !== "out-of-range") {
    return {
      bytes: writeSamples(values, original),
      encoding: original,
      rescaled: false,
      snapped: fit === "snapped",
      maxError: maxEncodingError(values, original),
      ...storedMinMax(values, original),
    };
  }

  const bitsAllocated = original.bitsAllocated === 8 ? 16 : original.bitsAllocated;
  const bitsStored = original.bitsAllocated === 8 ? 16 : original.bitsStored;
  const pixelRepresentation = original.pixelRepresentation;
  const [lo, hi] = storedRange(bitsStored, pixelRepresentation);

  // Prefer keeping slope 1 for integer-valued data if it fits by only shifting the intercept.
  let slope: number;
  let intercept: number;
  if (allIntegers(values) && max - min <= hi - lo) {
    slope = 1;
    intercept = min >= lo && max <= hi ? 0 : min - lo;
  } else if (original.intercept === 0 && (min >= 0 || lo < 0)) {
    // Keep intercept 0 (mandatory for PET, and what most viewers expect) and only adapt the slope.
    const needed = Math.max(max > 0 ? max / hi : 0, min < 0 ? min / lo : 0);
    slope = needed > 0 ? parseFloat(formatDS(needed * (1 + 1e-9))) : 1;
    intercept = 0;
  } else {
    // Slope/intercept are stored as 16-char decimal strings; quantize them up front so the stored
    // samples are computed against exactly the values a reader will parse back. Rounding the slope
    // up (tiny factor) keeps max inside the stored range.
    slope = max > min ? parseFloat(formatDS(((max - min) / (hi - lo)) * (1 + 1e-9))) : 1;
    intercept = parseFloat(formatDS(min - lo * slope));
  }
  const encoding: DicomPixelEncoding = {
    bitsAllocated,
    bitsStored,
    pixelRepresentation,
    slope,
    intercept,
    hasRescaleTags: original.hasRescaleTags || slope !== 1 || intercept !== 0,
  };
  return { bytes: writeSamples(values, encoding), encoding, rescaled: true, snapped: false, maxError: maxEncodingError(values, encoding), ...storedMinMax(values, encoding) };
}

function allIntegers(values: Float32Array): boolean {
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]) && !Number.isInteger(values[i])) return false;
  return true;
}

function fitsEncoding(values: Float32Array, enc: DicomPixelEncoding): "exact" | "snapped" | "out-of-range" {
  const [lo, hi] = storedRange(enc.bitsStored, enc.pixelRepresentation);
  let snapped = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) return "out-of-range";
    const q = (v - enc.intercept) / enc.slope;
    const r = Math.round(q);
    if (r < lo || r > hi) return "out-of-range";
    // Loaded values are float32(stored * slope + intercept); accept an exact float32 round-trip too,
    // since for large stored values float32 rounding can exceed the fixed tolerance.
    if (Math.abs(q - r) > GRID_TOLERANCE && Math.fround(r * enc.slope + enc.intercept) !== v) snapped = true;
  }
  return snapped ? "snapped" : "exact";
}

function toStored(v: number, enc: DicomPixelEncoding, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(hi, Math.max(lo, Math.round((v - enc.intercept) / enc.slope)));
}

function maxEncodingError(values: Float32Array, enc: DicomPixelEncoding): number {
  const [lo, hi] = storedRange(enc.bitsStored, enc.pixelRepresentation);
  let err = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;
    const back = toStored(values[i], enc, lo, hi) * enc.slope + enc.intercept;
    err = Math.max(err, Math.abs(back - values[i]));
  }
  return err;
}

function storedMinMax(values: Float32Array, enc: DicomPixelEncoding): { storedMin: number; storedMax: number } {
  const [lo, hi] = storedRange(enc.bitsStored, enc.pixelRepresentation);
  let storedMin = Infinity;
  let storedMax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const s = toStored(values[i], enc, lo, hi);
    if (s < storedMin) storedMin = s;
    if (s > storedMax) storedMax = s;
  }
  if (!Number.isFinite(storedMin)) storedMin = storedMax = 0;
  return { storedMin, storedMax };
}

function writeSamples(values: Float32Array, enc: DicomPixelEncoding): Uint8Array<ArrayBuffer> {
  const [lo, hi] = storedRange(enc.bitsStored, enc.pixelRepresentation);
  const bytesPerSample = enc.bitsAllocated / 8;
  const byteLength = values.length * bytesPerSample;
  const out = new Uint8Array(byteLength + (byteLength % 2)); // PixelData must have even length
  const dv = new DataView(out.buffer);
  const signed = enc.pixelRepresentation === 1;
  for (let i = 0; i < values.length; i++) {
    const s = toStored(values[i], enc, lo, hi);
    const o = i * bytesPerSample;
    if (bytesPerSample === 1) {
      if (signed) dv.setInt8(o, s);
      else dv.setUint8(o, s);
    } else if (bytesPerSample === 2) {
      if (signed) dv.setInt16(o, s, true);
      else dv.setUint16(o, s, true);
    } else if (signed) dv.setInt32(o, s, true);
    else dv.setUint32(o, s, true);
  }
  return out;
}
