import { describe, expect, it } from "vitest";
import { buildGeometry, gatherBackproject, scatterForwardProject } from "./geometry";
import { reconstructSliceFBP } from "./fbp";
import { reconstructSliceOSEM } from "./osem";

function evenlySpacedAngles(numAngles: number, spanDeg: number): Float64Array {
  const angles = new Float64Array(numAngles);
  for (let i = 0; i < numAngles; i++) angles[i] = (i * spanDeg) / numAngles;
  return angles;
}

/** Builds a point-source phantom and its exact forward projection for the given geometry. */
function pointSourceSinogram(cols: number, anglesDeg: Float64Array, px: number, py: number) {
  const geometry = buildGeometry(anglesDeg, cols);
  const image = new Float32Array(cols * cols);
  image[py * cols + px] = 1000;
  const allAngles = Array.from({ length: anglesDeg.length }, (_, i) => i);
  const sinogram = scatterForwardProject(image, geometry, allAngles);
  return { geometry, sinogram };
}

function argmax2D(slice: Float32Array, cols: number): { x: number; y: number } {
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < cols; y++) {
    for (let x = 0; x < cols; x++) {
      const v = slice[y * cols + x];
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  return { x: bx, y: by };
}

describe("geometry adjoint pair", () => {
  it("scatterForwardProject and gatherBackproject satisfy <Ax, y> == <x, A^T y>", () => {
    const cols = 16;
    const angles = evenlySpacedAngles(12, 180);
    const geometry = buildGeometry(angles, cols);
    const allAngles = Array.from({ length: angles.length }, (_, i) => i);

    const x = new Float32Array(cols * cols);
    for (let i = 0; i < x.length; i++) x[i] = Math.random();
    const y = new Float32Array(angles.length * cols);
    for (let i = 0; i < y.length; i++) y[i] = Math.random();

    const Ax = scatterForwardProject(x, geometry, allAngles);
    const ATy = gatherBackproject(y, geometry, allAngles, false);

    let lhs = 0;
    for (let i = 0; i < Ax.length; i++) lhs += Ax[i] * y[i];
    let rhs = 0;
    for (let i = 0; i < x.length; i++) rhs += x[i] * ATy[i];

    expect(lhs).toBeCloseTo(rhs, 3);
  });
});

describe("reconstructSliceFBP", () => {
  it("recovers the location of a single point source", () => {
    const cols = 32;
    const angles = evenlySpacedAngles(180, 180);
    const px = 20;
    const py = 16;
    const { sinogram } = pointSourceSinogram(cols, angles, px, py);

    const sliceSinogram = new Float32Array(angles.length * cols);
    sliceSinogram.set(sinogram);

    const recon = reconstructSliceFBP(sliceSinogram, angles, cols, "shepp-logan");
    const peak = argmax2D(recon, cols);

    expect(Math.abs(peak.x - px)).toBeLessThanOrEqual(1);
    expect(Math.abs(peak.y - py)).toBeLessThanOrEqual(1);
  });
});

describe("reconstructSliceOSEM", () => {
  it("recovers the location of a single point source", () => {
    const cols = 32;
    const angles = evenlySpacedAngles(60, 180);
    const px = 10;
    const py = 22;
    const { sinogram } = pointSourceSinogram(cols, angles, px, py);

    const recon = reconstructSliceOSEM(sinogram, angles, cols, 4, 6);
    const peak = argmax2D(recon, cols);

    expect(Math.abs(peak.x - px)).toBeLessThanOrEqual(1);
    expect(Math.abs(peak.y - py)).toBeLessThanOrEqual(1);
  });

  it("monotonically improves data fit (lower residual) across iterations", () => {
    const cols = 24;
    const angles = evenlySpacedAngles(40, 180);
    const { sinogram, geometry } = pointSourceSinogram(cols, angles, 12, 8);
    const allAngles = Array.from({ length: angles.length }, (_, i) => i);

    function residual(numIterations: number): number {
      const recon = reconstructSliceOSEM(sinogram, angles, cols, 4, numIterations);
      const simulated = scatterForwardProject(recon, geometry, allAngles);
      let sumSq = 0;
      for (let i = 0; i < simulated.length; i++) {
        const d = simulated[i] - sinogram[i];
        sumSq += d * d;
      }
      return sumSq;
    }

    expect(residual(4)).toBeLessThan(residual(1));
  });
});
