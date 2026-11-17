import * as dicomParser from "dicom-parser";
import { Volume3D } from "./volume";
import type { DicomPixelEncoding, DicomSourceFile, NiftiSourceInfo, VolumeSource } from "../dataset/types";
import { PixelDecodeError, decodePixelFrames, describeParseError } from "../dicom/pixelDecode";
import {
  type Vec3,
  type VolumeGeometry,
  add,
  cross,
  dot,
  geometryFromDicom,
  geometryFromNiftiQform,
  geometryFromNiftiSform,
  identityGeometry,
  normalize,
  scale,
} from "../core/geometry";

export class VolumeLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VolumeLoadError";
  }
}

export interface LoadedVolume {
  volume: Volume3D;
  source: VolumeSource;
}

/** Loads one or more files as a 3D volume. Supports NIfTI (.nii, .nii.gz) and DICOM. */
export async function loadVolumeFromFiles(files: File[]): Promise<LoadedVolume> {
  if (files.length === 0) throw new VolumeLoadError("Keine Dateien ausgewählt.");

  const niftiFiles = files.filter((f) => /\.nii(\.gz)?$/i.test(f.name));
  const dicomFiles = files.filter((f) => !/\.nii(\.gz)?$/i.test(f.name));

  if (niftiFiles.length > 0 && dicomFiles.length > 0)
    throw new VolumeLoadError("Bitte nur NIfTI- oder nur DICOM-Dateien auf einmal laden.");
  if (niftiFiles.length > 1)
    throw new VolumeLoadError("Bitte nur eine NIfTI-Datei gleichzeitig laden.");

  if (niftiFiles.length === 1) return loadNiftiFile(niftiFiles[0]);
  return loadDicomVolume(dicomFiles);
}

// ─── NIfTI ───────────────────────────────────────────────────────────────────

async function loadNiftiFile(file: File): Promise<LoadedVolume> {
  let buffer = await file.arrayBuffer();
  if (/\.gz$/i.test(file.name)) buffer = await decompressGzip(buffer);
  const { volume, nifti } = parseNifti1(buffer);
  return { volume, source: { kind: "nifti", fileName: file.name, nifti } };
}

async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(buffer));
  writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result.buffer as ArrayBuffer;
}

export function parseNifti1(buffer: ArrayBuffer): { volume: Volume3D; nifti: NiftiSourceInfo } {
  if (buffer.byteLength < 352)
    throw new VolumeLoadError("Datei zu klein für einen NIfTI-1-Header.");
  const view = new DataView(buffer);

  const sizeofHdrLE = view.getInt32(0, true);
  const littleEndian = sizeofHdrLE === 348;
  if (!littleEndian && view.getInt32(0, false) !== 348)
    throw new VolumeLoadError("Ungültiger NIfTI-1-Header (sizeof_hdr ≠ 348).");

  const ndim = view.getInt16(40, littleEndian);
  if (ndim < 3)
    throw new VolumeLoadError(`NIfTI hat nur ${ndim} Dimension(en) – mindestens 3D erwartet.`);

  const nx = view.getInt16(42, littleEndian);
  const ny = view.getInt16(44, littleEndian);
  const nz = view.getInt16(46, littleEndian);
  if (nx <= 0 || ny <= 0 || nz <= 0)
    throw new VolumeLoadError("NIfTI: ungültige Dimension(en).");

  const dx = Math.abs(view.getFloat32(80, littleEndian)) || 1; // pixdim[1] = spacingX
  const dy = Math.abs(view.getFloat32(84, littleEndian)) || 1; // pixdim[2] = spacingY
  const dz = Math.abs(view.getFloat32(88, littleEndian)) || 1; // pixdim[3] = spacingZ

  const datatype = view.getInt16(70, littleEndian);
  const voxOffset = Math.max(352, Math.round(view.getFloat32(108, littleEndian)));
  const sclSlope = view.getFloat32(112, littleEndian);
  const sclInter = view.getFloat32(116, littleEndian);
  const useScaling = sclSlope !== 0 && Number.isFinite(sclSlope);

  const n = nx * ny * nz;
  const data = new Float32Array(n);

  // NIfTI x-fastest (Fortran order) matches Volume3D (z*ny+y)*nx+x layout — no reorder needed.
  switch (datatype) {
    case 2: {
      const src = new Uint8Array(buffer, voxOffset, Math.min(n, buffer.byteLength - voxOffset));
      for (let i = 0; i < src.length; i++) data[i] = src[i];
      break;
    }
    case 4: {
      if (!littleEndian) throw new VolumeLoadError("Big-Endian NIfTI wird nicht unterstützt.");
      const src = new Int16Array(buffer.slice(voxOffset, voxOffset + n * 2));
      for (let i = 0; i < src.length; i++) data[i] = src[i];
      break;
    }
    case 512: {
      if (!littleEndian) throw new VolumeLoadError("Big-Endian NIfTI wird nicht unterstützt.");
      const src = new Uint16Array(buffer.slice(voxOffset, voxOffset + n * 2));
      for (let i = 0; i < src.length; i++) data[i] = src[i];
      break;
    }
    case 8: {
      if (!littleEndian) throw new VolumeLoadError("Big-Endian NIfTI wird nicht unterstützt.");
      const src = new Int32Array(buffer.slice(voxOffset, voxOffset + n * 4));
      for (let i = 0; i < src.length; i++) data[i] = src[i];
      break;
    }
    case 16: {
      if (!littleEndian) throw new VolumeLoadError("Big-Endian NIfTI wird nicht unterstützt.");
      const src = new Float32Array(buffer.slice(voxOffset, voxOffset + n * 4));
      data.set(src.subarray(0, n));
      break;
    }
    case 64: {
      if (!littleEndian) throw new VolumeLoadError("Big-Endian NIfTI wird nicht unterstützt.");
      const src = new Float64Array(buffer.slice(voxOffset, voxOffset + n * 8));
      for (let i = 0; i < Math.min(n, src.length); i++) data[i] = src[i];
      break;
    }
    default:
      throw new VolumeLoadError(`NIfTI-Datentyp ${datatype} wird nicht unterstützt.`);
  }

  if (useScaling) {
    for (let i = 0; i < n; i++) data[i] = data[i] * sclSlope + sclInter;
  }

  const nifti: NiftiSourceInfo = {
    headerBytes: new Uint8Array(buffer.slice(0, voxOffset)),
    littleEndian,
    datatype,
    sclSlope,
    sclInter,
  };
  return { volume: new Volume3D(data, nz, ny, nx, [dz, dy, dx], readNiftiGeometry(view, littleEndian, [dx, dy, dz])), nifti };
}

/** sform (preferred) or qform geometry; axis-aligned pixdim fallback if neither is set. */
function readNiftiGeometry(view: DataView, le: boolean, pixdim: Vec3): VolumeGeometry {
  const qformCode = view.getInt16(252, le);
  const sformCode = view.getInt16(254, le);
  if (sformCode > 0) {
    const srow: number[] = [];
    for (let i = 0; i < 12; i++) srow.push(view.getFloat32(280 + i * 4, le));
    if (srow.every(Number.isFinite) && srow.some((v, i) => i % 4 !== 3 && v !== 0)) return geometryFromNiftiSform(srow);
  }
  if (qformCode > 0) {
    const f = (o: number) => view.getFloat32(o, le);
    return geometryFromNiftiQform(f(256), f(260), f(264), [f(268), f(272), f(276)], pixdim, f(76));
  }
  return identityGeometry(pixdim);
}

// ─── DICOM ───────────────────────────────────────────────────────────────────

const EXPLICIT_VR_LE = "1.2.840.10008.1.2.1";

interface ParsedDicomFile {
  file: DicomSourceFile;
  rows: number;
  cols: number;
  spacing: [number, number, number];
  pixelSpacing: [number, number];
  /** ImageOrientationPatient (6 values) if known. */
  iop?: number[];
  /** ImagePositionPatient of each frame, if known. */
  positions?: Vec3[];
  frameOfReferenceUid?: string;
  instanceNumber: number;
  sliceLocation: number;
  frames: Float32Array[];
}

async function loadDicomVolume(files: File[]): Promise<LoadedVolume> {
  if (files.length === 0) throw new VolumeLoadError("Keine Dateien ausgewählt.");
  const parsed = await Promise.all(files.map(parseDicomFile));

  // Sort by position along the slice normal when patient coordinates are known, else by
  // InstanceNumber / SliceLocation.
  const iop = parsed[0].iop;
  const withPositions = iop && parsed.every((p) => p.positions && p.positions.length > 0);
  if (parsed.length > 1) {
    if (withPositions) {
      const normal = cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]);
      const key = (p: ParsedDicomFile) => dot(p.positions![0], normal);
      parsed.sort((a, b) => key(a) - key(b) || a.instanceNumber - b.instanceNumber);
    } else {
      parsed.sort((a, b) =>
        a.instanceNumber !== b.instanceNumber ? a.instanceNumber - b.instanceNumber : a.sliceLocation - b.sliceLocation,
      );
    }
  }
  const { rows, cols } = parsed[0];
  if (!parsed.every((p) => p.rows === rows && p.cols === cols))
    throw new VolumeLoadError("DICOM-Serie: inkonsistente Bildgrößen.");

  const nz = parsed.reduce((sum, p) => sum + p.frames.length, 0);
  const sliceSize = rows * cols;
  const data = new Float32Array(nz * sliceSize);
  let z = 0;
  for (const p of parsed) {
    p.file.zStart = z;
    const { slope, intercept } = p.file.encoding;
    for (const frame of p.frames) {
      const base = z * sliceSize;
      for (let i = 0; i < sliceSize; i++) data[base + i] = frame[i] * slope + intercept;
      z++;
    }
  }

  const geometry = withPositions
    ? geometryFromDicom(
        iop,
        parsed[0].pixelSpacing,
        parsed.flatMap((p) => p.positions!),
        parsed[0].spacing[0],
        parsed[0].frameOfReferenceUid,
      )
    : undefined;
  const volume = new Volume3D(data, nz, rows, cols, parsed[0].spacing, geometry);
  return {
    volume,
    source: { kind: "dicom", layout: parsed.length > 1 ? "series" : "multiframe", files: parsed.map((p) => p.file) },
  };
}

/** Parses a Part10 file, falling back to a bare Explicit VR Little Endian dataset (no preamble). */
export function parseDicomBytes(bytes: Uint8Array): dicomParser.DataSet {
  try {
    return dicomParser.parseDicom(bytes);
  } catch (e) {
    const message = describeParseError(e);
    if (message.includes("DICM prefix not found") || message.includes("attempt to read past end of buffer")) {
      return dicomParser.parseDicom(bytes, { TransferSyntaxUID: EXPLICIT_VR_LE });
    }
    throw e;
  }
}

async function parseDicomFile(file: File): Promise<ParsedDicomFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let dataSet: dicomParser.DataSet;
  try {
    dataSet = parseDicomBytes(bytes);
  } catch (e) {
    throw new VolumeLoadError(`DICOM-Parser-Fehler in ${file.name}: ${describeParseError(e)}`);
  }

  const transferSyntax = dataSet.string("x00020010")?.trim() || undefined;
  if (transferSyntax === "1.2.840.10008.1.2.2" || transferSyntax === "1.2.840.10008.1.2.1.99")
    throw new VolumeLoadError(`${file.name}: Transfer Syntax ${transferSyntax} (Big Endian/Deflate) wird nicht unterstützt.`);
  if (dataSet.elements["x7fe00008"] || dataSet.elements["x7fe00009"])
    throw new VolumeLoadError(`${file.name}: Float-PixelData wird nicht unterstützt.`);

  const rows = dataSet.uint16("x00280010") ?? 0;
  const cols = dataSet.uint16("x00280011") ?? 0;
  const nFrames = parseInt(dataSet.string("x00280008") ?? "1", 10) || 1;
  if (!rows || !cols) throw new VolumeLoadError(`DICOM: Bildgröße nicht lesbar in ${file.name}.`);
  if ((dataSet.uint16("x00280002") ?? 1) !== 1)
    throw new VolumeLoadError(`${file.name}: Nur Graustufenbilder (SamplesPerPixel = 1) werden unterstützt.`);

  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const encoding: DicomPixelEncoding = {
    bitsAllocated,
    bitsStored: dataSet.uint16("x00280101") ?? bitsAllocated,
    pixelRepresentation: dataSet.uint16("x00280103") ?? 0,
    slope: parseFloat(dataSet.string("x00281053") ?? "1") || 1,
    intercept: parseFloat(dataSet.string("x00281052") ?? "0") || 0,
    hasRescaleTags: !!dataSet.elements["x00281053"] || !!dataSet.elements["x00281052"],
  };

  let frames: Float32Array[];
  try {
    frames = decodePixelFrames(dataSet, {
      numberOfFrames: nFrames,
      rows,
      cols,
      bitsAllocated,
      pixelRepresentation: encoding.pixelRepresentation,
    });
  } catch (e) {
    if (e instanceof PixelDecodeError) throw new VolumeLoadError(`${file.name}: ${e.message}`);
    throw e;
  }
  if (encoding.bitsStored < bitsAllocated) maskStoredBits(frames, encoding);

  const spacing = readDicomSpacing(dataSet);
  const pixelSpacing: [number, number] = [spacing[1], spacing[2]];
  const iop = readOrientation(dataSet);
  return {
    file: { fileName: file.name, bytes, dataSet, transferSyntax, zStart: 0, nFrames, encoding },
    rows,
    cols,
    spacing,
    pixelSpacing,
    iop,
    positions: iop ? readFramePositions(dataSet, nFrames, iop, spacing[0]) : undefined,
    frameOfReferenceUid: dataSet.string("x00200052")?.split(String.fromCharCode(0)).join("").trim() || undefined,
    instanceNumber: parseInt(dataSet.string("x00200013") ?? "0", 10) || 0,
    sliceLocation: parseFloat(dataSet.string("x00201041") ?? "0") || 0,
    frames,
  };
}

/** Restricts samples to BitsStored (high bits may contain overlay/garbage), sign-extending if signed. */
function maskStoredBits(frames: Float32Array[], enc: DicomPixelEncoding): void {
  const bits = enc.bitsStored;
  const range = 2 ** bits;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      let v = ((frame[i] % range) + range) % range;
      if (enc.pixelRepresentation === 1 && v >= range / 2) v -= range;
      frame[i] = v;
    }
  }
}

function parseNumbers(s: string | undefined): number[] | undefined {
  if (!s) return undefined;
  const values = s.split("\\").map((v) => parseFloat(v));
  return values.every(Number.isFinite) ? values : undefined;
}

function firstItem(dataSet: dicomParser.DataSet, tag: string): dicomParser.DataSet | undefined {
  return dataSet.elements[tag]?.items?.[0]?.dataSet;
}

/** ImageOrientationPatient: top level, Shared Functional Groups, or NM Detector Information. */
function readOrientation(dataSet: dicomParser.DataSet): number[] | undefined {
  const candidates = [
    dataSet,
    firstItem(firstItem(dataSet, "x52009229") ?? dataSet, "x00209116"),
    firstItem(dataSet, "x00540022"),
  ];
  for (const ds of candidates) {
    const v = ds && parseNumbers(ds.string("x00200037"));
    if (v && v.length === 6) return v;
  }
  return undefined;
}

/**
 * ImagePositionPatient of every frame: per-frame functional groups if present, otherwise the
 * top-level (or NM Detector Information) position of the first frame, with further frames stepped
 * along row × column by the slice spacing (NM reconstructed multi-frame convention).
 */
function readFramePositions(dataSet: dicomParser.DataSet, nFrames: number, iop: number[], sliceSpacing: number): Vec3[] | undefined {
  const perFrame = dataSet.elements["x52009230"]?.items;
  if (perFrame && perFrame.length === nFrames) {
    const positions = perFrame.map((it) => parseNumbers(firstItem(it.dataSet!, "x00209113")?.string("x00200032")));
    if (positions.every((p) => p && p.length === 3)) return positions as Vec3[];
  }
  const first = parseNumbers(dataSet.string("x00200032")) ?? parseNumbers(firstItem(dataSet, "x00540022")?.string("x00200032"));
  if (!first || first.length !== 3) return undefined;
  const normal = normalize(cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]));
  const p0: Vec3 = [first[0], first[1], first[2]];
  return Array.from({ length: nFrames }, (_, f) => add(p0, scale(normal, f * sliceSpacing)));
}

function readDicomSpacing(dataSet: dicomParser.DataSet): [number, number, number] {
  const pixelSpacingStr = dataSet.string("x00280030");
  let spacingRow = 1, spacingCol = 1;
  if (pixelSpacingStr) {
    const parts = pixelSpacingStr.split("\\").map(Number);
    spacingRow = parts[0] || 1;
    spacingCol = parts[1] || 1;
  }
  const spacingZ =
    parseFloat(dataSet.string("x00180088") ?? "") || parseFloat(dataSet.string("x00180050") ?? "1") || 1;
  return [spacingZ, spacingRow, spacingCol];
}
