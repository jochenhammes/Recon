import { describe, expect, it } from "vitest";
import { worldToVoxelTransform } from "../core/geometry";
import { matrixFromParams, IDENTITY_PARAMS, transformedWorldToVoxel } from "../core/transform";
import { resampleInto } from "../resample/resample";
import { motionCorrect } from "./motion";

const N = 40, S = 3;
const geometry = { origin: [-(N - 1) * S / 2, -(N - 1) * S / 2, -(N - 1) * S / 2] as [number, number, number], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]], spacing: [S, S, S] as [number, number, number] };
const grid = { nx: N, ny: N, nz: N, geometry };

/** Asymmetric blob phantom (world mm). */
function phantom(): Float32Array {
  const out = new Float32Array(N * N * N);
  const blobs = [[0, 0, 0, 30, 1], [15, 10, -5, 8, 3], [-12, -14, 10, 6, 4], [5, -18, -15, 5, 2]];
  for (let k = 0, o = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++, o++) {
        const x = geometry.origin[0] + i * S, y = geometry.origin[1] + j * S, z = geometry.origin[2] + k * S;
        for (const [cx, cy, cz, r, a] of blobs) out[o] += a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (2 * r * r));
      }
  return out;
}

describe("motion correction", () => {
  it("recovers known rigid frame motion", () => {
    const base = phantom();
    const shifts = [[0, 0, 0, 0], [3, -2, 1, 0], [-4, 2, 2, 4], [1, 5, -3, -3]]; // tx, ty, tz (mm), rz (deg)
    const w2v = worldToVoxelTransform(geometry);
    const frames = shifts.map(([tx, ty, tz, rz]) => {
      const M = matrixFromParams({ ...IDENTITY_PARAMS, tx, ty, tz, rz }, [0, 0, 0]);
      // Frame = phantom moved by M (sample the phantom at M⁻¹·p).
      return resampleInto({ ...grid, data: base }, transformedWorldToVoxel(w2v, M), grid, "linear");
    });
    const r = motionCorrect(frames, grid, [0, 60, 120, 180], [60, 60, 60, 60], 0);
    // Registered matrix maps frame → reference: residual motion after correction must be small (< 1 mm at 80 mm).
    const ref = r.motion[0].matrix;
    for (let f = 1; f < 4; f++) {
      const [tx, ty, tz, rz] = shifts[f];
      const M = matrixFromParams({ ...IDENTITY_PARAMS, tx, ty, tz, rz }, [0, 0, 0]);
      // composite = motion · M should equal the reference frame's motion (frame 0 is the unmoved phantom).
      const c = r.motion[f].matrix;
      const p = [40, 30, -20];
      const moved = [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]];
      const back = [c[0] * moved[0] + c[1] * moved[1] + c[2] * moved[2] + c[3], c[4] * moved[0] + c[5] * moved[1] + c[6] * moved[2] + c[7], c[8] * moved[0] + c[9] * moved[1] + c[10] * moved[2] + c[11]];
      const r0 = [ref[0] * p[0] + ref[1] * p[1] + ref[2] * p[2] + ref[3], ref[4] * p[0] + ref[5] * p[1] + ref[6] * p[2] + ref[7], ref[8] * p[0] + ref[9] * p[1] + ref[10] * p[2] + ref[11]];
      expect(Math.hypot(back[0] - r0[0], back[1] - r0[1], back[2] - r0[2])).toBeLessThan(1);
      expect(r.motion[f].maxShiftMm).toBeGreaterThan(1);
    }
    expect(r.frames).toHaveLength(4);
  }, 120000);
});
