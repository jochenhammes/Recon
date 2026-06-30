import type { SpectProjectionSet } from "../dicom/types";

/**
 * Combined sinogram built from all detector heads, sorted by absolute projection angle.
 * `data` layout is [angle][axialRow][col] flattened row-major: index = (a * rows + row) * cols + col.
 */
export interface Sinogram {
  numAngles: number;
  anglesDeg: Float64Array;
  /** Number of axial slices (one reconstructed image per row). */
  rows: number;
  /** In-plane reconstructed image size (square: cols x cols). */
  cols: number;
  pixelSpacingMm: [number, number];
  data: Float32Array;
}

/** Merges projections from both detector heads into one angle-sorted sinogram. */
export function buildSinogram(projectionSet: SpectProjectionSet): Sinogram {
  const { rows, cols, frames, pixelSpacingMm } = projectionSet;
  const sorted = [...frames].sort((a, b) => a.angleDeg - b.angleDeg);
  const numAngles = sorted.length;
  const anglesDeg = new Float64Array(numAngles);
  const data = new Float32Array(numAngles * rows * cols);
  const sliceStride = cols;
  const angleStride = rows * cols;
  for (let a = 0; a < numAngles; a++) {
    anglesDeg[a] = sorted[a].angleDeg;
    const pixels = sorted[a].pixels;
    const base = a * angleStride;
    for (let r = 0; r < rows; r++) {
      const srcBase = r * cols;
      const dstBase = base + r * sliceStride;
      for (let c = 0; c < cols; c++) {
        data[dstBase + c] = pixels[srcBase + c];
      }
    }
  }
  return { numAngles, anglesDeg, rows, cols, pixelSpacingMm, data };
}

/** Extracts a contiguous axial-row range [zStart, zEnd) into a standalone Sinogram (own buffer). */
export function sliceSinogramRows(sino: Sinogram, zStart: number, zEnd: number): Sinogram {
  const chunkRows = zEnd - zStart;
  const data = new Float32Array(sino.numAngles * chunkRows * sino.cols);
  const srcAngleStride = sino.rows * sino.cols;
  const dstAngleStride = chunkRows * sino.cols;
  for (let a = 0; a < sino.numAngles; a++) {
    const src = a * srcAngleStride + zStart * sino.cols;
    const dst = a * dstAngleStride;
    data.set(sino.data.subarray(src, src + chunkRows * sino.cols), dst);
  }
  return {
    numAngles: sino.numAngles,
    anglesDeg: sino.anglesDeg.slice(),
    rows: chunkRows,
    cols: sino.cols,
    pixelSpacingMm: sino.pixelSpacingMm,
    data,
  };
}

/** Extracts the 1D-per-angle sinogram (numAngles x cols) for a single axial slice z. */
export function getSliceSinogram(sino: Sinogram, z: number): Float32Array {
  const out = new Float32Array(sino.numAngles * sino.cols);
  const angleStride = sino.rows * sino.cols;
  for (let a = 0; a < sino.numAngles; a++) {
    const src = a * angleStride + z * sino.cols;
    out.set(sino.data.subarray(src, src + sino.cols), a * sino.cols);
  }
  return out;
}
