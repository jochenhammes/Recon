import type { VolumeGeometry, WorldToVoxel } from "../core/geometry";
import type { PlaneKind } from "./planes";
import type { ColorLut, Volume3D } from "./volume";

export type ViewKind = PlaneKind | "mip";
export type LayoutKind = "grid" | "focus" | "single";

export interface LayerDisplay {
  /** Window [min, max] in raw (stored real) units. */
  window: [number, number];
  lut: ColorLut;
  /** 0..1, used when the layer is drawn on top of another layer. */
  opacity: number;
  visible: boolean;
  /** Nearest-neighbour sampling (label images: no blending of label numbers). */
  nearest?: boolean;
}

/** Minimal voxel grid the viewer can sample (a Volume3D, or e.g. a VOI mask). */
export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  data: ArrayLike<number>;
  geometry: VolumeGeometry;
}

/** A volume shown in the viewer, bottom layer first. */
export interface ViewerLayer {
  id: string;
  label: string;
  volume: Volume3D | VoxelGrid;
  /** Not listed in the status bar (e.g. VOI overlay). */
  hideInStatus?: boolean;
  /** World → voxel index transform (geometry plus any registration). */
  w2v: WorldToVoxel;
  display: LayerDisplay;
  /** How to show values in the status bar (e.g. SUV = raw × scale). */
  unit?: { scale: number; label: string };
}

export interface ViewTransform {
  zoom: number;
  /** Pan offset in CSS pixels. */
  panX: number;
  panY: number;
}

export const IDENTITY_TRANSFORM: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
