import type { Volume3D } from "../viewer/volume";

/**
 * Separable 3D Gaussian smoothing with the given FWHM in mm (per axis converted to voxels).
 * Edges are handled by renormalizing the kernel over the voxels inside the volume, so the mean
 * level is preserved near borders. NaN voxels are treated as missing.
 */
export function gaussianSmooth(volume: Volume3D, fwhmMm: number): Float32Array {
  const { nx, ny, nz } = volume;
  const sigmaMm = fwhmMm / (2 * Math.sqrt(2 * Math.log(2)));
  let buf: Float32Array = Float32Array.from(volume.data);
  const dims = [nx, ny, nz];
  const strides = [1, nx, nx * ny];
  for (let axis = 0; axis < 3; axis++) {
    const sigma = sigmaMm / volume.geometry.spacing[axis];
    if (!(sigma > 0.05) || dims[axis] < 2) continue;
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const kernel = new Float64Array(2 * radius + 1);
    for (let i = -radius; i <= radius; i++) kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    buf = convolveAxis(buf, dims, strides, axis, kernel, radius);
  }
  return buf;
}

function convolveAxis(src: Float32Array, dims: number[], strides: number[], axis: number, kernel: Float64Array, radius: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(src.length);
  const n = dims[axis];
  const stride = strides[axis];
  const line = new Float64Array(n);
  const [a1, a2] = [0, 1, 2].filter((a) => a !== axis);
  for (let p = 0; p < dims[a2]; p++)
    for (let q = 0; q < dims[a1]; q++) {
      const base = p * strides[a2] + q * strides[a1];
      for (let i = 0; i < n; i++) line[i] = src[base + i * stride];
      for (let i = 0; i < n; i++) {
        let s = 0;
        let w = 0;
        const lo = Math.max(0, i - radius);
        const hi = Math.min(n - 1, i + radius);
        for (let j = lo; j <= hi; j++) {
          const v = line[j];
          if (v !== v) continue;
          const k = kernel[j - i + radius];
          s += v * k;
          w += k;
        }
        out[base + i * stride] = w > 0 ? s / w : NaN;
      }
    }
  return out;
}
