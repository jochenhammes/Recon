import type { RampFilterType } from "./fft";
import { reconstructSliceFBP } from "./fbp";
import { reconstructSliceOSEM } from "./osem";
import { getSliceSinogram, type Sinogram } from "./sinogram";

export type ReconParams =
  | { algorithm: "fbp"; filterType: RampFilterType }
  | { algorithm: "osem"; numSubsets: number; numIterations: number };

/**
 * Reconstructs axial slices [zStart, zEnd) of the given sinogram, returning a flat
 * Float32Array of length (zEnd - zStart) * cols * cols, slice-major.
 */
export function reconstructSliceRange(
  sino: Sinogram,
  params: ReconParams,
  zStart: number,
  zEnd: number,
  onSliceDone?: (zIndexInRange: number) => void,
): Float32Array {
  const { cols, anglesDeg } = sino;
  const sliceSize = cols * cols;
  const out = new Float32Array((zEnd - zStart) * sliceSize);
  for (let z = zStart; z < zEnd; z++) {
    const sliceSinogram = getSliceSinogram(sino, z);
    const slice =
      params.algorithm === "fbp"
        ? reconstructSliceFBP(sliceSinogram, anglesDeg, cols, params.filterType)
        : reconstructSliceOSEM(sliceSinogram, anglesDeg, cols, params.numSubsets, params.numIterations);
    out.set(slice, (z - zStart) * sliceSize);
    onSliceDone?.(z - zStart);
  }
  return out;
}
