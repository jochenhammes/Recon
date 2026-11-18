import type { DataSet } from "dicom-parser";
import type { ReconParams } from "../recon/volume";
import type { Volume3D } from "../viewer/volume";
import type { EditOp } from "../edit/operations";
import type { HeaderEdit } from "../header/headerModel";
import type { TemplateInfo } from "../normalization/templates";
import type { AtlasInfo } from "../atlas/atlas";

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

/** Frames of a dynamic (4D) acquisition; the dataset's volume is their time-weighted mean. */
export interface DynamicInfo {
  /** One array per frame, on the dataset's grid. */
  frames: Float32Array[];
  /** Frame start times and durations in seconds (start relative to injection if known, else to the first frame). */
  start: number[];
  duration: number[];
  /** Where the timing comes from. */
  timeSource: "dicom" | "bids" | "nifti" | "manuell";
  /** e.g. "Start relativ zum ersten Frame (Injektionszeit fehlt)". */
  note?: string;
}

/** A volume loaded or reconstructed in the app, together with its provenance and edit history. */
export interface LoadedDataset {
  /** Volume as originally loaded/reconstructed; used for "reset". */
  original: Volume3D;
  /** Current, possibly edited, volume; shown in the viewer and exported. */
  current: Volume3D;
  /** Applied edits in order; `current` = original with all edits replayed (undo = replay one less). */
  edits: EditOp[];
  /** Pending DICOM header changes (header editor), applied on DICOM export. */
  headerEdits: HeaderEdit[];
  /** Set when the dataset is a standard-space template (e.g. MNI T1). */
  template?: TemplateInfo;
  /** Set when the dataset is a label atlas (region indices). */
  atlas?: AtlasInfo;
  /** Set for datasets resampled into a standard space: name, original source (for SUV/units) and space. */
  derivedFrom?: { name: string; source: VolumeSource; space: string; /** Overrides the modality label (e.g. "SUVR"). */ label?: string };
  source: VolumeSource;
  displayName: string;
  /** Dynamic acquisition (frames + timing), if the data were 4D. */
  dynamic?: DynamicInfo;
}

export function createDataset(volume: Volume3D, source: VolumeSource, displayName: string): LoadedDataset {
  return { original: volume, current: volume, edits: [], headerEdits: [], source, displayName };
}
