import { buildGeometry, gatherBackproject, scatterForwardProject } from "./geometry";

const EPSILON = 1e-6;

function buildSubsets(numAngles: number, numSubsets: number): number[][] {
  const clamped = Math.max(1, Math.min(numSubsets, numAngles));
  const subsets: number[][] = Array.from({ length: clamped }, () => []);
  for (let i = 0; i < numAngles; i++) subsets[i % clamped].push(i);
  return subsets;
}

function extractRows(sliceSinogram: Float32Array, cols: number, indices: number[]): Float32Array {
  const out = new Float32Array(indices.length * cols);
  for (let ai = 0; ai < indices.length; ai++) {
    const src = indices[ai] * cols;
    out.set(sliceSinogram.subarray(src, src + cols), ai * cols);
  }
  return out;
}

/** Ordered-subsets expectation maximization reconstruction of a single sinogram slice. */
export function reconstructSliceOSEM(
  sliceSinogram: Float32Array,
  anglesDeg: Float64Array,
  cols: number,
  numSubsets: number,
  numIterations: number,
): Float32Array {
  const numAngles = anglesDeg.length;
  const geometry = buildGeometry(anglesDeg, cols);
  const subsets = buildSubsets(numAngles, numSubsets);

  const sensitivities = subsets.map((indices) => {
    const ones = new Float32Array(indices.length * cols).fill(1);
    const sens = gatherBackproject(ones, geometry, indices, false);
    for (let i = 0; i < sens.length; i++) sens[i] = Math.max(sens[i], EPSILON);
    return sens;
  });

  let estimate = new Float32Array(cols * cols).fill(1);

  for (let iter = 0; iter < numIterations; iter++) {
    for (let s = 0; s < subsets.length; s++) {
      const indices = subsets[s];
      const measured = extractRows(sliceSinogram, cols, indices);
      const simulated = scatterForwardProject(estimate, geometry, indices);
      const ratio = new Float32Array(simulated.length);
      for (let i = 0; i < ratio.length; i++) ratio[i] = measured[i] / Math.max(simulated[i], EPSILON);
      const correction = gatherBackproject(ratio, geometry, indices, false);
      const sens = sensitivities[s];
      const next = new Float32Array(estimate.length);
      for (let p = 0; p < next.length; p++) {
        const updated = estimate[p] * (correction[p] / sens[p]);
        next[p] = updated > 0 ? updated : 0;
      }
      estimate = next;
    }
  }

  return estimate;
}
