import { type WorldToVoxel, scale, voxelToWorld } from "../core/geometry";
import { samplePlane } from "../viewer/planes";
import type { VoxelGrid } from "../viewer/types";
import { Volume3D } from "../viewer/volume";

/**
 * Resamples `source` (via its world→voxel transform, which may include a registration) onto the
 * voxel grid of `target` with trilinear interpolation. Points outside the source become 0. The
 * result carries the target's geometry (incl. frame of reference).
 */
export function resampleToGrid(source: VoxelGrid, w2v: WorldToVoxel, target: Volume3D): Volume3D {
  const g = target.geometry;
  const { nx, ny, nz } = target;
  const out = new Float32Array(nx * ny * nz);
  const U = scale(g.axes[0], g.spacing[0]);
  const V = scale(g.axes[1], g.spacing[1]);
  const slice = new Float32Array(nx * ny);
  for (let k = 0; k < nz; k++) {
    const origin = voxelToWorld(g, 0, 0, k);
    samplePlane(source, w2v, { kind: "axial", origin, U, V, width: nx, height: ny }, slice);
    for (let i = 0; i < slice.length; i++) {
      const v = slice[i];
      out[k * slice.length + i] = v === v ? v : 0;
    }
  }
  return target.withData(out);
}
