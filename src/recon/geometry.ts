/**
 * Shared parallel-beam projection geometry for a square (cols x cols) reconstructed slice.
 *
 * Uses a pixel-driven bilinear interpolation model: `gather` (backprojection, A^T) reads a
 * sinogram value at the projected coordinate of each pixel; `scatter` (forward projection, A)
 * is its exact adjoint, splatting each pixel's value into the two nearest sinogram columns.
 * Keeping forward/back projection as an exact adjoint pair is important for OSEM convergence.
 */
export interface Geometry {
  cols: number;
  numAngles: number;
  cosTable: Float64Array;
  sinTable: Float64Array;
  /** Local angular spacing (radians) per angle, wraparound-aware; used to weight FBP backprojection. */
  angleWeightsRad: Float64Array;
}

export function buildGeometry(anglesDeg: Float64Array, cols: number): Geometry {
  const numAngles = anglesDeg.length;
  const cosTable = new Float64Array(numAngles);
  const sinTable = new Float64Array(numAngles);
  for (let a = 0; a < numAngles; a++) {
    const rad = (anglesDeg[a] * Math.PI) / 180;
    cosTable[a] = Math.cos(rad);
    sinTable[a] = Math.sin(rad);
  }

  const angleWeightsRad = new Float64Array(numAngles);
  if (numAngles === 1) {
    angleWeightsRad[0] = Math.PI;
  } else {
    for (let a = 0; a < numAngles; a++) {
      const prev = a === 0 ? anglesDeg[numAngles - 1] - 360 : anglesDeg[a - 1];
      const next = a === numAngles - 1 ? anglesDeg[0] + 360 : anglesDeg[a + 1];
      angleWeightsRad[a] = ((next - prev) / 2) * (Math.PI / 180);
    }
  }

  return { cols, numAngles, cosTable, sinTable, angleWeightsRad };
}

/** A^T: backprojects a (numAngles x cols) sinogram into a (cols x cols) image. */
export function gatherBackproject(
  sinogram: Float32Array,
  geometry: Geometry,
  angleIndices: ArrayLike<number>,
  weighted: boolean,
): Float32Array {
  const { cols } = geometry;
  const image = new Float32Array(cols * cols);
  const center = (cols - 1) / 2;
  for (let ai = 0; ai < angleIndices.length; ai++) {
    const a = angleIndices[ai];
    const cosT = geometry.cosTable[a];
    const sinT = geometry.sinTable[a];
    const weight = weighted ? geometry.angleWeightsRad[a] : 1;
    const rowBase = ai * cols;
    for (let yi = 0; yi < cols; yi++) {
      const y = yi - center;
      const rowOut = yi * cols;
      for (let xi = 0; xi < cols; xi++) {
        const x = xi - center;
        const t = x * cosT + y * sinT + center;
        const c0 = Math.floor(t);
        const frac = t - c0;
        let value = 0;
        if (c0 >= 0 && c0 < cols) value += (1 - frac) * sinogram[rowBase + c0];
        if (c0 + 1 >= 0 && c0 + 1 < cols) value += frac * sinogram[rowBase + c0 + 1];
        image[rowOut + xi] += value * weight;
      }
    }
  }
  return image;
}

/** A: forward-projects a (cols x cols) image into a (angleIndices.length x cols) sinogram (exact adjoint of gatherBackproject). */
export function scatterForwardProject(
  image: Float32Array,
  geometry: Geometry,
  angleIndices: ArrayLike<number>,
): Float32Array {
  const { cols } = geometry;
  const out = new Float32Array(angleIndices.length * cols);
  const center = (cols - 1) / 2;
  for (let ai = 0; ai < angleIndices.length; ai++) {
    const a = angleIndices[ai];
    const cosT = geometry.cosTable[a];
    const sinT = geometry.sinTable[a];
    const rowBase = ai * cols;
    for (let yi = 0; yi < cols; yi++) {
      const y = yi - center;
      const rowIn = yi * cols;
      for (let xi = 0; xi < cols; xi++) {
        const x = xi - center;
        const v = image[rowIn + xi];
        if (v === 0) continue;
        const t = x * cosT + y * sinT + center;
        const c0 = Math.floor(t);
        const frac = t - c0;
        if (c0 >= 0 && c0 < cols) out[rowBase + c0] += (1 - frac) * v;
        if (c0 + 1 >= 0 && c0 + 1 < cols) out[rowBase + c0 + 1] += frac * v;
      }
    }
  }
  return out;
}
