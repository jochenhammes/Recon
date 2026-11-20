import { type Vec3, type VolumeGeometry, cross, dot, normalize, sub, volumeCenter, voxelToWorld, worldToVoxel } from "../core/geometry";
import { type Mat4, applyMat4, invert4 } from "../core/transform";
import { mapVoxel, rotatedGeometry } from "./geometryOps";
import type { EditOp } from "./operations";

/** A dataset taking part in a common geometry edit. */
export interface GroupTarget {
  geometry: VolumeGeometry;
  dims: Vec3;
  /** Native → reference world (registration). */
  matrix: Mat4;
  /** Label image: resampling with nearest neighbour. */
  labels?: boolean;
}

/** What the user asked for, in patient terms of the reference world. */
export type GroupGeometryAction =
  | { kind: "flip"; patientAxis: 0 | 1 | 2 }
  /** Quarter turns about the head–foot axis; `sense` = rotation sense of the active dataset's index plane. */
  | { kind: "rotate"; turns: number; sense: number }
  | { kind: "resample"; spacing: Vec3 };

const UNIT: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Direction of a reference-world axis in the dataset's native world. */
function nativeDirection(matrix: Mat4, axis: 0 | 1 | 2): Vec3 {
  const inv = invert4(matrix);
  return normalize(sub(applyMat4(inv, UNIT[axis]), applyMat4(inv, [0, 0, 0])));
}

/** Index axis of the dataset that runs closest to the given native direction. */
function closestIndexAxis(g: VolumeGeometry, dir: Vec3): 0 | 1 | 2 {
  const s = g.axes.map((a) => Math.abs(dot(a, dir)));
  return (s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2) as 0 | 1 | 2;
}

/** Rotation sense of a quarter turn in the index plane (x, y) relative to the head–foot axis: +1 or −1. */
export function rotationSense(t: Pick<GroupTarget, "geometry" | "matrix">): number {
  const g = t.geometry;
  return Math.sign(dot(cross(g.axes[0], g.axes[1]), nativeDirection(t.matrix, 2))) || 1;
}

/** Whether the slice axis (index z) is the head–foot axis, so a quarter turn in the slice plane is axial. */
export function rotatesAxially(t: Pick<GroupTarget, "geometry" | "matrix">): boolean {
  return closestIndexAxis(t.geometry, nativeDirection(t.matrix, 2)) === 2;
}

/**
 * Edit for one dataset of a common geometry edit. Mirroring and rotation happen about `center` (reference
 * world, e.g. the center of the active dataset), so datasets that lie on top of each other stay aligned;
 * `center` null (dataset in another space, e.g. standard space) uses the dataset's own center.
 */
export function groupEditFor(t: GroupTarget, action: GroupGeometryAction, center: Vec3 | null, group: string): EditOp | null {
  if (action.kind === "resample") return { type: "resample", spacing: action.spacing, ...(t.labels ? { nearest: true } : {}), group };
  const c = center ? worldToVoxel(t.geometry, applyMat4(invert4(t.matrix), center)) : (t.dims.map((n) => (n - 1) / 2) as Vec3);
  const cWorld = voxelToWorld(t.geometry, c[0], c[1], c[2]);

  let op: { type: "flip"; axis: 0 | 1 | 2 } | { type: "rotate90"; turns: number };
  let after: VolumeGeometry;
  if (action.kind === "flip") {
    op = { type: "flip", axis: closestIndexAxis(t.geometry, nativeDirection(t.matrix, action.patientAxis)) };
    after = t.geometry;
  } else {
    if (!rotatesAxially(t)) return null;
    const turns = rotationSense(t) === action.sense ? action.turns : 4 - action.turns;
    op = { type: "rotate90", turns };
    after = rotatedGeometry(t.geometry, t.dims, turns);
  }
  const m = mapVoxel(t.dims, op, c);
  const shift = sub(cWorld, voxelToWorld(after, m[0], m[1], m[2]));
  return op.type === "flip" ? { ...op, patientAxis: action.kind === "flip" ? action.patientAxis : undefined, shift, group } : { ...op, shift, group };
}

/** Center of a dataset in the reference world. */
export function referenceCenter(t: GroupTarget): Vec3 {
  return applyMat4(t.matrix, volumeCenter(t.geometry, t.dims));
}
