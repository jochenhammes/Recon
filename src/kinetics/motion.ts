import { type Vec3, type VolumeGeometry, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4, type Mat4, paramsFromMatrix, transformedWorldToVoxel } from "../core/transform";
import { coregister } from "../registration/coregister";
import { resampleAtPoints, resampleInto } from "../resample/resample";

export interface FrameMotion {
  /** Frame → reference matrix (world, mm). */
  matrix: Mat4;
  /** Translation (mm) and rotation (degrees) of the frame relative to the reference. */
  t: Vec3;
  r: Vec3;
  /** Largest displacement of a point 80 mm from the volume center (mm). */
  maxShiftMm: number;
  /** false: early frame, motion taken from the first registered frame. */
  registered: boolean;
}

export interface MotionResult {
  frames: Float32Array[];
  motion: FrameMotion[];
}

interface Grid {
  nx: number;
  ny: number;
  nz: number;
  geometry: VolumeGeometry;
}

/** Duration-weighted mean of the frames that start at or after `fromSec` (all frames if none do). */
export function referenceImage(frames: Float32Array[], startSec: number[], durationSec: number[], fromSec: number): Float32Array {
  let idx = frames.map((_, i) => i).filter((i) => startSec[i] >= fromSec);
  if (!idx.length) idx = frames.map((_, i) => i);
  const out = new Float32Array(frames[0].length);
  const total = idx.reduce((a, i) => a + durationSec[i], 0) || idx.length;
  for (const i of idx) {
    const w = (durationSec[i] || 1) / total;
    const f = frames[i];
    for (let v = 0; v < out.length; v++) out[v] += w * f[v];
  }
  return out;
}

function describe(M: Mat4, center: Vec3, registered: boolean): FrameMotion {
  const p = paramsFromMatrix(M, center);
  // Displacement of points on a sphere (r = 80 mm) around the center: max over the 6 axis points.
  let maxShiftMm = 0;
  for (const d of [[80, 0, 0], [-80, 0, 0], [0, 80, 0], [0, -80, 0], [0, 0, 80], [0, 0, -80]]) {
    const q: Vec3 = [center[0] + d[0], center[1] + d[1], center[2] + d[2]];
    const m: Vec3 = [M[0] * q[0] + M[1] * q[1] + M[2] * q[2] + M[3], M[4] * q[0] + M[5] * q[1] + M[6] * q[2] + M[7], M[8] * q[0] + M[9] * q[1] + M[10] * q[2] + M[11]];
    maxShiftMm = Math.max(maxShiftMm, Math.hypot(m[0] - q[0], m[1] - q[1], m[2] - q[2]));
  }
  return { matrix: M, t: p ? [p.tx, p.ty, p.tz] : [0, 0, 0], r: p ? [p.rx, p.ry, p.rz] : [0, 0, 0], maxShiftMm, registered };
}

/**
 * Frame-to-reference motion correction: frames starting at or after `fromSec` are registered rigidly (NMI) to the
 * mean of those frames; earlier frames (little signal, changing distribution) take the motion of the first
 * registered frame. All frames are resampled onto the reference (= original) grid.
 */
export function motionCorrect(
  frames: Float32Array[],
  grid: Grid,
  startSec: number[],
  durationSec: number[],
  fromSec: number,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): MotionResult {
  const dims: Vec3 = [grid.nx, grid.ny, grid.nz];
  const ref = { data: referenceImage(frames, startSec, durationSec, fromSec), dims, geometry: grid.geometry };
  const center = voxelToWorld(grid.geometry, (grid.nx - 1) / 2, (grid.ny - 1) / 2, (grid.nz - 1) / 2);
  const toRegister = frames.map((_, i) => i).filter((i) => startSec[i] >= fromSec);
  const matrices: (Mat4 | null)[] = frames.map(() => null);
  let done = 0;
  for (const i of toRegister) {
    if (shouldStop?.()) throw new DOMException("Bewegungskorrektur abgebrochen.", "AbortError");
    onProgress?.(done, toRegister.length);
    const r = coregister(ref, { data: frames[i], dims, geometry: grid.geometry }, { dof: 6, cost: "nmi", levels: [8, 4, 3], coarseSearch: false, initial: IDENTITY_MAT4, maxSamples: 60_000 }, undefined, shouldStop);
    matrices[i] = r.matrix;
    done++;
  }
  onProgress?.(done, toRegister.length);
  const firstRegistered = toRegister.length ? matrices[toRegister[0]]! : IDENTITY_MAT4;
  const motion = frames.map((_, i) => describe(matrices[i] ?? firstRegistered, center, matrices[i] !== null));
  const w2v = worldToVoxelTransform(grid.geometry);
  const target = { nx: grid.nx, ny: grid.ny, nz: grid.nz, geometry: grid.geometry };
  const out = frames.map((f, i) => {
    const M = motion[i].matrix;
    return M.every((v, k) => v === IDENTITY_MAT4[k]) ? f : resampleInto({ ...target, data: f }, transformedWorldToVoxel(w2v, M), target, "linear");
  });
  return { frames: out, motion };
}

/** Every frame resampled at the given world positions (e.g. the pulled-back MNI grid). */
export function framesAtPoints(frames: Float32Array[], grid: Grid, toSubject: Mat4, points: Float32Array, onProgress?: (done: number, total: number) => void): Float32Array[] {
  const w2v = transformedWorldToVoxel(worldToVoxelTransform(grid.geometry), toSubject);
  return frames.map((f, i) => {
    onProgress?.(i, frames.length);
    return resampleAtPoints({ nx: grid.nx, ny: grid.ny, nz: grid.nz, geometry: grid.geometry, data: f }, w2v, points, "linear");
  });
}
