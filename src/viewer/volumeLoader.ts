import * as dicomParser from "dicom-parser";
import { Volume3D } from "./volume";

export class VolumeLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VolumeLoadError";
  }
}

/** Loads one or more files as a 3D volume. Supports NIfTI (.nii, .nii.gz) and DICOM. */
export async function loadVolumeFromFiles(files: File[]): Promise<Volume3D> {
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

async function loadNiftiFile(file: File): Promise<Volume3D> {
  let buffer = await file.arrayBuffer();
  if (/\.gz$/i.test(file.name)) buffer = await decompressGzip(buffer);
  return parseNifti1(buffer);
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

function parseNifti1(buffer: ArrayBuffer): Volume3D {
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

  return new Volume3D(data, nz, ny, nx, [dz, dy, dx]);
}

// ─── DICOM ───────────────────────────────────────────────────────────────────

async function loadDicomVolume(files: File[]): Promise<Volume3D> {
  if (files.length === 0) throw new VolumeLoadError("Keine Dateien ausgewählt.");
  if (files.length === 1) return loadSingleDicom(files[0]);
  return loadDicomSeries(files);
}

async function loadSingleDicom(file: File): Promise<Volume3D> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(bytes);
  } catch (e) {
    throw new VolumeLoadError(`DICOM-Parser-Fehler: ${String(e)}`);
  }

  const rows = dataSet.uint16("x00280010") ?? 0;
  const cols = dataSet.uint16("x00280011") ?? 0;
  const nFrames = parseInt(dataSet.string("x00280008") ?? "1", 10);
  if (!rows || !cols || !nFrames)
    throw new VolumeLoadError("DICOM: Bildgröße oder Frame-Anzahl nicht lesbar.");

  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const pixelRep = dataSet.uint16("x00280103") ?? 0;
  const slope = parseFloat(dataSet.string("x00281053") ?? "1") || 1;
  const intercept = parseFloat(dataSet.string("x00281052") ?? "0") || 0;
  const [spacingZ, spacingRow, spacingCol] = readDicomSpacing(dataSet);

  const pixelEl = dataSet.elements["x7fe00010"];
  if (!pixelEl) throw new VolumeLoadError("DICOM: Keine Pixeldaten gefunden.");

  const pixelsPerFrame = rows * cols;
  const data = new Float32Array(nFrames * pixelsPerFrame);
  const bytesPerPixel = bitsAllocated / 8;

  for (let f = 0; f < nFrames; f++) {
    const byteOffset = pixelEl.dataOffset + f * pixelsPerFrame * bytesPerPixel;
    const raw = bytes.buffer.slice(byteOffset, byteOffset + pixelsPerFrame * bytesPerPixel);
    const frameBase = f * pixelsPerFrame;
    applyPixelData(raw, data, frameBase, pixelsPerFrame, bitsAllocated, pixelRep, slope, intercept);
  }

  return new Volume3D(data, nFrames, rows, cols, [spacingZ, spacingRow, spacingCol]);
}

interface DicomSlice {
  instanceNumber: number;
  sliceLocation: number;
  rows: number;
  cols: number;
  spacingRow: number;
  spacingCol: number;
  spacingZ: number;
  pixelData: Float32Array;
}

async function loadDicomSeries(files: File[]): Promise<Volume3D> {
  const slices: DicomSlice[] = await Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let dataSet: dicomParser.DataSet;
      try {
        dataSet = dicomParser.parseDicom(bytes);
      } catch (e) {
        throw new VolumeLoadError(`DICOM-Parser-Fehler in ${file.name}: ${String(e)}`);
      }

      const rows = dataSet.uint16("x00280010") ?? 0;
      const cols = dataSet.uint16("x00280011") ?? 0;
      if (!rows || !cols)
        throw new VolumeLoadError(`DICOM: Bildgröße nicht lesbar in ${file.name}.`);

      const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
      const pixelRep = dataSet.uint16("x00280103") ?? 0;
      const slope = parseFloat(dataSet.string("x00281053") ?? "1") || 1;
      const intercept = parseFloat(dataSet.string("x00281052") ?? "0") || 0;
      const instanceNumber = parseInt(dataSet.string("x00200013") ?? "0", 10);
      const sliceLocation = parseFloat(dataSet.string("x00201041") ?? "0") || 0;
      const [spacingZ, spacingRow, spacingCol] = readDicomSpacing(dataSet);

      const pixelEl = dataSet.elements["x7fe00010"];
      if (!pixelEl) throw new VolumeLoadError(`DICOM: Keine Pixeldaten in ${file.name}.`);

      const n = rows * cols;
      const pixelData = new Float32Array(n);
      const bytesPerPixel = bitsAllocated / 8;
      const raw = bytes.buffer.slice(pixelEl.dataOffset, pixelEl.dataOffset + n * bytesPerPixel);
      applyPixelData(raw, pixelData, 0, n, bitsAllocated, pixelRep, slope, intercept);

      return { instanceNumber, sliceLocation, rows, cols, spacingRow, spacingCol, spacingZ, pixelData };
    }),
  );

  slices.sort((a, b) =>
    a.instanceNumber !== b.instanceNumber
      ? a.instanceNumber - b.instanceNumber
      : a.sliceLocation - b.sliceLocation,
  );

  const { rows, cols } = slices[0];
  if (!slices.every((s) => s.rows === rows && s.cols === cols))
    throw new VolumeLoadError("DICOM-Serie: inkonsistente Bildgrößen.");

  const nz = slices.length;
  const data = new Float32Array(nz * rows * cols);
  for (let z = 0; z < nz; z++) data.set(slices[z].pixelData, z * rows * cols);

  const { spacingRow, spacingCol, spacingZ } = slices[0];
  return new Volume3D(data, nz, rows, cols, [spacingZ, spacingRow, spacingCol]);
}

function readDicomSpacing(dataSet: dicomParser.DataSet): [number, number, number] {
  const pixelSpacingStr = dataSet.string("x00280030");
  let spacingRow = 1, spacingCol = 1;
  if (pixelSpacingStr) {
    const parts = pixelSpacingStr.split("\\").map(Number);
    spacingRow = parts[0] || 1;
    spacingCol = parts[1] || 1;
  }
  const spacingZ = parseFloat(dataSet.string("x00180050") ?? "1") || 1;
  return [spacingZ, spacingRow, spacingCol];
}

function applyPixelData(
  raw: ArrayBuffer,
  out: Float32Array,
  outBase: number,
  n: number,
  bitsAllocated: number,
  pixelRep: number,
  slope: number,
  intercept: number,
): void {
  if (bitsAllocated === 16) {
    const src = pixelRep === 1 ? new Int16Array(raw) : new Uint16Array(raw);
    for (let i = 0; i < Math.min(n, src.length); i++)
      out[outBase + i] = src[i] * slope + intercept;
  } else if (bitsAllocated === 8) {
    const src = new Uint8Array(raw);
    for (let i = 0; i < Math.min(n, src.length); i++)
      out[outBase + i] = src[i] * slope + intercept;
  } else {
    throw new VolumeLoadError(`DICOM: ${bitsAllocated}-bit-Pixel werden nicht unterstützt.`);
  }
}
