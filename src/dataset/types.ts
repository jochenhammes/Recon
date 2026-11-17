import type { DataSet } from "dicom-parser";
import type { ReconParams } from "../recon/volume";
import type { Volume3D } from "../viewer/volume";
import type { EditOp } from "../edit/operations";

/** How stored DICOM sample values map to real values: real = stored * slope + intercept. */
export interface DicomPixelEncoding {
  bitsAllocated: number;
  bitsStored: number;
  /** 0 = unsigned, 1 = signed (two's complement). */
  pixelRepresentation: number;
  slope: number;
  intercept: number;
  /** Whether RescaleSlope/RescaleIntercept were present in the original header. */
  hasRescaleTags: boolean;
}

/** One original DICOM file that contributes frames [zStart, zStart + nFrames) of the volume. */
export interface DicomSourceFile {
  fileName: string;
  /** Untouched original file bytes; the header-preserving exporter copies elements from here. */
  bytes: Uint8Array;
  dataSet: DataSet;
  /** TransferSyntaxUID of the file, or undefined for a bare dataset without Part10 meta header. */
  transferSyntax?: string;
  zStart: number;
  nFrames: number;
  encoding: DicomPixelEncoding;
}

export interface NiftiSourceInfo {
  /** Original header bytes from offset 0 up to vox_offset (348-byte header + extension block). */
  headerBytes: Uint8Array;
  littleEndian: boolean;
  datatype: number;
  sclSlope: number;
  sclInter: number;
}

export type VolumeSource =
  | { kind: "reconstruction"; reconParams?: ReconParams }
  | { kind: "nifti"; fileName: string; nifti: NiftiSourceInfo }
  | { kind: "dicom"; layout: "multiframe" | "series"; files: DicomSourceFile[] };

/** A volume loaded or reconstructed in the app, together with its provenance and edit history. */
export interface LoadedDataset {
  /** Volume as originally loaded/reconstructed; used for "reset". */
  original: Volume3D;
  /** Current, possibly edited, volume; shown in the viewer and exported. */
  current: Volume3D;
  /** Applied edits in order; `current` = original with all edits replayed (undo = replay one less). */
  edits: EditOp[];
  source: VolumeSource;
  displayName: string;
}

export function createDataset(volume: Volume3D, source: VolumeSource, displayName: string): LoadedDataset {
  return { original: volume, current: volume, edits: [], source, displayName };
}
