import type { Vec3, VolumeGeometry } from "../core/geometry";
import type { EditOp } from "../edit/operations";

export interface EditJob {
  id: number;
  data: Float32Array;
  /** [nx, ny, nz] */
  dims: Vec3;
  geometry: VolumeGeometry;
  ops: EditOp[];
}

export type EditJobResult =
  | { id: number; ok: true; data: Float32Array; dims: Vec3; geometry: VolumeGeometry; affected: number }
  | { id: number; ok: false; error: string };
