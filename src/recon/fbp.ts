import type { RampFilterType } from "./fft";
import { filterSinogramSlice } from "./fft";
import { buildGeometry, gatherBackproject } from "./geometry";

/** Filtered backprojection reconstruction of a single (numAngles x cols) sinogram slice. */
export function reconstructSliceFBP(
  sliceSinogram: Float32Array,
  anglesDeg: Float64Array,
  cols: number,
  filterType: RampFilterType,
): Float32Array {
  const numAngles = anglesDeg.length;
  const filtered = filterSinogramSlice(sliceSinogram, numAngles, cols, filterType);
  const geometry = buildGeometry(anglesDeg, cols);
  const allAngles = Array.from({ length: numAngles }, (_, i) => i);
  return gatherBackproject(filtered, geometry, allAngles, true);
}
