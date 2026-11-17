import type { DataSet } from "dicom-parser";
import { type Vec3, type WorldToVoxel, voxelToWorld } from "../core/geometry";
import { type TargetGrid, resampleInto } from "../resample/resample";
import { compositeLayers } from "../viewer/composite";
import type { LayerDisplay, VoxelGrid } from "../viewer/types";
import { buildNiftiFile } from "./niftiWriter";
import { concatBytes } from "./bytes";
import { formatDS } from "./dicomRewriter";
import { ElementWriter, IMPLEMENTATION_CLASS_UID, IMPLEMENTATION_VERSION_NAME } from "./dicomWriter";
import { generateUid } from "./uid";
import { Volume3D } from "../viewer/volume";

/** One displayed layer (bottom first) with its placement and display settings. */
export interface FusionLayer {
  volume: VoxelGrid;
  w2v: WorldToVoxel;
  display: LayerDisplay;
}

/** RGB volume (r, g, b interleaved per voxel, x fastest) of the composited layers on `grid`. */
export function renderFusion(layers: FusionLayer[], grid: TargetGrid, onProgress?: (f: number) => void): Uint8Array<ArrayBuffer> {
  const visible = layers.filter((l) => l.display.visible && (l === layers[0] || l.display.opacity > 0));
  const plane = grid.nx * grid.ny;
  const values = visible.map((l, i) => {
    onProgress?.((0.8 * i) / Math.max(1, visible.length));
    return resampleInto(l.volume, l.w2v, grid, "linear");
  });
  const rgb = new Uint8Array(plane * grid.nz * 3);
  const rgba = new Uint8ClampedArray(plane * 4);
  for (let k = 0; k < grid.nz; k++) {
    compositeLayers(
      visible.map((l, i) => ({ values: values[i].subarray(k * plane, (k + 1) * plane), window: l.display.window, lut: l.display.lut, opacity: l.display.opacity })),
      plane,
      rgba,
    );
    const o = k * plane * 3;
    for (let p = 0; p < plane; p++) {
      rgb[o + 3 * p] = rgba[4 * p];
      rgb[o + 3 * p + 1] = rgba[4 * p + 1];
      rgb[o + 3 * p + 2] = rgba[4 * p + 2];
    }
  }
  onProgress?.(1);
  return rgb;
}

/** Grid aligned with the patient axes (axial slices, L→R columns… as LPS) covering `base`, isotropic voxels. */
export function axialGridCovering(base: TargetGrid, voxelMm?: number): TargetGrid {
  const s = voxelMm ?? Math.min(...base.geometry.spacing);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of [-0.5, base.nx - 0.5])
    for (const j of [-0.5, base.ny - 0.5])
      for (const k of [-0.5, base.nz - 0.5]) {
        const p = voxelToWorld(base.geometry, i, j, k);
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], p[a]);
          hi[a] = Math.max(hi[a], p[a]);
        }
      }
  const n = [0, 1, 2].map((a) => Math.max(1, Math.round((hi[a] - lo[a]) / s))) as Vec3;
  return {
    nx: n[0],
    ny: n[1],
    nz: n[2],
    geometry: {
      origin: [lo[0] + s / 2, lo[1] + s / 2, lo[2] + s / 2],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      spacing: [s, s, s],
      frameOfReferenceUid: base.geometry.frameOfReferenceUid,
    },
  };
}

/** NIfTI-1 RGB24 volume (datatype 128) with the grid's orientation. */
export function buildFusionNifti(rgb: Uint8Array, grid: TargetGrid): Uint8Array<ArrayBuffer> {
  const { nx, ny, nz, geometry } = grid;
  const dummy = new Volume3D(new Float32Array(1), 1, 1, 1, [geometry.spacing[2], geometry.spacing[1], geometry.spacing[0]], geometry);
  const header = buildNiftiFile(dummy).slice(0, 352);
  const dv = new DataView(header.buffer);
  dv.setInt16(42, nx, true);
  dv.setInt16(44, ny, true);
  dv.setInt16(46, nz, true);
  dv.setInt16(70, 128, true); // DT_RGB24
  dv.setInt16(72, 24, true);
  const desc = "Recon Studio fusion (RGB)";
  for (let i = 0; i < 80; i++) dv.setUint8(148 + i, i < desc.length ? desc.charCodeAt(i) : 0);
  return concatBytes([header, rgb]);
}

export interface FusionDicomMeta {
  seriesDescription: string;
  /** Header of the base dataset: patient/study identity is copied unless `anonymize`. */
  source?: DataSet;
  anonymize: boolean;
}

const SC_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.7";

/**
 * One Secondary Capture RGB DICOM file per slice (8 bit, PlanarConfiguration 0) with Image Plane
 * attributes, so that viewers place the fusion in the patient coordinate system of the base study.
 */
export function buildFusionDicomSeries(rgb: Uint8Array, grid: TargetGrid, meta: FusionDicomMeta): { name: string; bytes: Uint8Array<ArrayBuffer> }[] {
  const { nx, ny, nz, geometry: g } = grid;
  const src = meta.source && !meta.anonymize ? meta.source : undefined;
  const get = (tag: string) => src?.string(tag)?.trim() || undefined;
  const studyUid = get("x0020000d") ?? generateUid();
  const seriesUid = generateUid();
  const forUid = (!meta.anonymize && g.frameOfReferenceUid) || generateUid();
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const ds = (v: number) => formatDS(Math.abs(v) < 1e-9 ? 0 : v);
  const plane = nx * ny;
  const files: { name: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (let k = 0; k < nz; k++) {
    const sop = generateUid();
    const m = new ElementWriter();
    m.element(0x0002, 0x0001, "OB", Uint8Array.of(0, 1));
    m.str(0x0002, 0x0002, "UI", SC_IMAGE_STORAGE, "\0");
    m.str(0x0002, 0x0003, "UI", sop, "\0");
    m.str(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1", "\0");
    m.str(0x0002, 0x0012, "UI", IMPLEMENTATION_CLASS_UID, "\0");
    m.str(0x0002, 0x0013, "SH", IMPLEMENTATION_VERSION_NAME);
    const metaBytes = m.bytes();
    const mg = new ElementWriter();
    mg.ul(0x0002, 0x0000, metaBytes.length);

    const pos = voxelToWorld(g, 0, 0, k);
    const w = new ElementWriter();
    w.str(0x0008, 0x0008, "CS", "DERIVED\\SECONDARY\\FUSION");
    w.str(0x0008, 0x0016, "UI", SC_IMAGE_STORAGE, "\0");
    w.str(0x0008, 0x0018, "UI", sop, "\0");
    w.str(0x0008, 0x0020, "DA", get("x00080020") ?? date);
    w.str(0x0008, 0x0021, "DA", date);
    w.str(0x0008, 0x0030, "TM", get("x00080030") ?? time);
    w.str(0x0008, 0x0031, "TM", time);
    w.str(0x0008, 0x0050, "SH", get("x00080050") ?? "");
    w.str(0x0008, 0x0060, "CS", "OT");
    w.str(0x0008, 0x0064, "CS", "SYN"); // ConversionType: synthetic image
    w.str(0x0008, 0x103e, "LO", meta.seriesDescription.slice(0, 64));
    w.str(0x0010, 0x0010, "PN", get("x00100010") ?? "ANONYMIZED");
    w.str(0x0010, 0x0020, "LO", get("x00100020") ?? "ANONYMIZED");
    w.str(0x0010, 0x0030, "DA", get("x00100030") ?? "");
    w.str(0x0010, 0x0040, "CS", get("x00100040") ?? "");
    w.str(0x0018, 0x0050, "DS", ds(g.spacing[2]));
    w.str(0x0020, 0x000d, "UI", studyUid, "\0");
    w.str(0x0020, 0x000e, "UI", seriesUid, "\0");
    w.str(0x0020, 0x0010, "SH", get("x00200010") ?? "1");
    w.str(0x0020, 0x0011, "IS", "9901");
    w.str(0x0020, 0x0013, "IS", String(k + 1));
    w.str(0x0020, 0x0032, "DS", pos.map(ds).join("\\"));
    w.str(0x0020, 0x0037, "DS", [...g.axes[0], ...g.axes[1]].map(ds).join("\\"));
    w.str(0x0020, 0x0052, "UI", forUid, "\0");
    w.str(0x0020, 0x1041, "DS", ds(pos[0] * g.axes[2][0] + pos[1] * g.axes[2][1] + pos[2] * g.axes[2][2]));
    w.us(0x0028, 0x0002, 3); // SamplesPerPixel
    w.str(0x0028, 0x0004, "CS", "RGB");
    w.us(0x0028, 0x0006, 0); // PlanarConfiguration: interleaved
    w.us(0x0028, 0x0010, ny);
    w.us(0x0028, 0x0011, nx);
    w.str(0x0028, 0x0030, "DS", `${ds(g.spacing[1])}\\${ds(g.spacing[0])}`);
    w.us(0x0028, 0x0100, 8);
    w.us(0x0028, 0x0101, 8);
    w.us(0x0028, 0x0102, 7);
    w.us(0x0028, 0x0103, 0);
    const px = rgb.slice(k * plane * 3, (k + 1) * plane * 3);
    w.element(0x7fe0, 0x0010, "OB", px.length % 2 ? concatBytes([px, new Uint8Array(1)]) : px);
    files.push({ name: `FUSION_${String(k + 1).padStart(4, "0")}.dcm`, bytes: concatBytes([new Uint8Array(128), new TextEncoder().encode("DICM"), mg.bytes(), metaBytes, w.bytes()]) });
  }
  return files;
}
