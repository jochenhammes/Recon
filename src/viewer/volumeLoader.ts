import * as dicomParser from "dicom-parser";
import { Volume3D } from "./volume";
import type { DicomPixelEncoding, DicomSourceFile, DynamicInfo, NiftiSourceInfo, VolumeSource } from "../dataset/types";
import { parseDicomDateTime } from "../analysis/suv";
import { guessNiftiModality } from "../dataset/describe";
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
import { type AtlasInfo, atlasFromLabels, parseLabelTable } from "../atlas/atlas";
import { LABEL_FILE_NAME, looksLikeLabels, niftiLabelInfo, parseXmlLabelTable } from "../atlas/labelNifti";

export class VolumeLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VolumeLoadError";
  }
}

export interface LoadedVolume {
  volume: Volume3D;
  source: VolumeSource;
  /** Set for label images (atlas, segmentation) recognized from the NIfTI header, a label table or the file name. */
  atlas?: AtlasInfo;
  /** Set for dynamic (4D) data: frames and timing; `volume` is the time-weighted mean. */
  dynamic?: DynamicInfo;
}

/** Time-weighted mean of the frames (equal weights if durations are unknown). */
export function meanOfFrames(frames: Float32Array[], duration?: number[]): Float32Array {
  const out = new Float32Array(frames[0].length);
  const w = frames.map((_, i) => (duration && duration[i] > 0 ? duration[i] : 1));
  const total = w.reduce((a, b) => a + b, 0);
  frames.forEach((f, i) => {
    const k = w[i] / total;
    for (let v = 0; v < out.length; v++) out[v] += k * f[v];
  });
  return out;
}

/** BIDS PET sidecar: FrameTimesStart / FrameDuration (seconds). */
export function parseBidsTiming(json: string, frames: number): { start: number[]; duration: number[] } | null {
  try {
    const j = JSON.parse(json) as { FrameTimesStart?: number[]; FrameDuration?: number[] };
    if (Array.isArray(j.FrameTimesStart) && Array.isArray(j.FrameDuration) && j.FrameTimesStart.length === frames && j.FrameDuration.length === frames)
      return { start: j.FrameTimesStart.map(Number), duration: j.FrameDuration.map(Number) };
  } catch {
    /* not a BIDS sidecar */
  }
  return null;
}

const NIFTI_NAME = /\.nii(\.gz)?$/i;
/** Label tables that may accompany a label image (FSL/FreeSurfer LUT, ITK-SNAP, TSV/CSV, Caret XML). */
const TABLE_NAME = /\.(txt|tsv|csv|lut|label|xml)$/i;
const JSON_NAME = /\.json$/i;
const baseName = (n: string) => n.replace(NIFTI_NAME, "").replace(/\.(nii\.)?(txt|tsv|csv|lut|label|xml)$/i, "").toLowerCase();

/**
 * Atlas information of a loaded NIfTI: label table from the header (Recon Studio export, Caret XML) or an
 * accompanying table file; otherwise integer images marked as labels or named like label images.
 */
export function detectAtlas(volume: Volume3D, nifti: NiftiSourceInfo, fileName: string, table?: Map<number, string>): AtlasInfo | undefined {
  const info = niftiLabelInfo(nifti.headerBytes, nifti.littleEndian);
  const labels = table?.size ? table : info?.labels;
  if (!labels?.size && !info?.intentLabel && !LABEL_FILE_NAME.test(fileName.replace(NIFTI_NAME, ""))) return undefined;
  if (!looksLikeLabels(volume.data)) return undefined;
  const atlas = atlasFromLabels(volume.data, info?.name ?? fileName.replace(NIFTI_NAME, ""), labels);
  return info?.attribution ? { ...atlas, attribution: info.attribution } : atlas;
}

async function readTable(file: File): Promise<Map<number, string>> {
  const text = await file.text();
  return /<Label\b/.test(text) ? parseXmlLabelTable(text) : parseLabelTable(text);
}

/** Label table for a NIfTI: same base name, or the only table if there is only one NIfTI. */
function tableFor(nifti: File, niftis: File[], tables: File[]): File | undefined {
  return tables.find((t) => baseName(t.name) === baseName(nifti.name)) ?? (niftis.length === 1 && tables.length === 1 ? tables[0] : undefined);
}

export interface LoadedItem {
  loaded: LoadedVolume;
  /** Display name: series description / file name with number of files. */
  name: string;
}

export interface MultiLoadResult {
  items: LoadedItem[];
  /** Files (or series) that could not be read and were ignored. */
  skipped: string[];
}

const isIgnorable = (f: File) => f.name.startsWith(".") || f.name.toUpperCase() === "DICOMDIR";

/**
 * Loads everything in a selection: every NIfTI file and every DICOM series (grouped by Series Instance
 * UID, image size and orientation; multi-frame files separately) becomes its own volume. Unreadable files
 * and series that cannot be assembled are skipped and reported; the rest loads normally.
 */
export async function loadVolumesFromFiles(input: File[]): Promise<MultiLoadResult> {
  const files = input.filter((f) => !isIgnorable(f));
  const items: LoadedItem[] = [];
  const skipped: string[] = [];
  const niftis = files.filter((x) => NIFTI_NAME.test(x.name));
  const tables = niftis.length ? files.filter((x) => TABLE_NAME.test(x.name)) : [];
  const jsons = files.filter((x) => JSON_NAME.test(x.name));
  for (const f of niftis) {
    try {
      const t = tableFor(f, niftis, tables);
      const sidecar = jsons.find((j) => j.name.replace(JSON_NAME, "").toLowerCase() === baseName(f.name)) ?? (niftis.length === 1 && jsons.length === 1 ? jsons[0] : undefined);
      items.push({ loaded: await loadNiftiFile(f, t ? await readTable(t) : undefined, sidecar ? await sidecar.text() : undefined), name: f.name });
    } catch {
      skipped.push(f.name);
    }
  }
  const dicomFiles = files.filter((x) => !NIFTI_NAME.test(x.name) && !tables.includes(x) && !jsons.includes(x));
  const results = await Promise.allSettled(dicomFiles.map(parseDicomFile));
  const ok: ParsedDicomFile[] = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? ok.push(r.value) : skipped.push(dicomFiles[i].name)));
  const groups = new Map<string, ParsedDicomFile[]>();
  for (const p of ok) {
    const ds = p.file.dataSet;
    const uid = ds.string("x0020000e")?.trim() ?? "";
    const iop = p.iop ? p.iop.map((v) => v.toFixed(2)).join(",") : "";
    const key = [uid, p.rows, p.cols, iop, p.frames.length > 1 ? p.file.fileName : ""].join("|");
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  const series: (LoadedItem & { number: number })[] = [];
  for (const g of groups.values()) {
    try {
      const loaded = buildDicomDynamic(g) ?? buildDicomVolume(g);
      const ds = g[0].file.dataSet;
      const desc = ds.string("x0008103e")?.trim();
      const number = parseInt(ds.string("x00200011") ?? "", 10);
      const base = desc || (g.length === 1 ? g[0].file.fileName : "Serie");
      series.push({ loaded, name: g.length > 1 ? `${base} (${g.length} Dateien)` : base, number: Number.isFinite(number) ? number : 1e9 });
    } catch {
      skipped.push(`Serie mit ${g.length} Datei(en)`);
    }
  }
  series.sort((a, b) => a.number - b.number);
  items.push(...series.map(({ loaded, name }) => ({ loaded, name })));
  return { items, skipped };
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

async function loadNiftiFile(file: File, table?: Map<number, string>, sidecarJson?: string): Promise<LoadedVolume> {
  let buffer = await file.arrayBuffer();
  if (/\.gz$/i.test(file.name)) buffer = await decompressGzip(buffer);
  const { volume, nifti } = parseNifti1(buffer);
  const dynamic = niftiDynamic(buffer, volume, sidecarJson);
  if (dynamic) {
    // The dataset shows the time-weighted mean; the frames are kept for kinetic modelling.
    const mean = volume.withData(meanOfFrames(dynamic.frames, dynamic.duration));
    const modalityGuess = guessNiftiModality(file.name, mean, { dynamic: true, sidecar: sidecarJson });
    return { volume: mean, source: { kind: "nifti", fileName: file.name, nifti, modalityGuess }, dynamic };
  }
  const atlas = detectAtlas(volume, nifti, file.name, table);
  const modalityGuess = atlas ? undefined : guessNiftiModality(file.name, volume, { sidecar: sidecarJson });
  return { volume, source: { kind: "nifti", fileName: file.name, nifti, modalityGuess }, atlas };
}

/** All frames of a 4D NIfTI (dim[4] > 1) with timing from a BIDS sidecar or pixdim[4]; null for 3D files. */
function niftiDynamic(buffer: ArrayBuffer, volume: Volume3D, sidecarJson?: string): DynamicInfo | null {
  const view = new DataView(buffer);
  const le = view.getInt32(0, true) === 348;
  if (!le || view.getInt16(40, true) < 4) return null;
  const nt = view.getInt16(48, true);
  if (nt <= 1) return null;
  const n = volume.nx * volume.ny * volume.nz;
  const voxOffset = Math.max(352, Math.round(view.getFloat32(108, true)));
  const all = readNiftiValues(buffer, true, view.getInt16(70, true), voxOffset, n * nt);
  const slope = view.getFloat32(112, true), inter = view.getFloat32(116, true);
  if (slope !== 0 && Number.isFinite(slope)) for (let i = 0; i < all.length; i++) all[i] = all[i] * slope + inter;
  const frames = Array.from({ length: nt }, (_, t) => all.slice(t * n, (t + 1) * n));
  const bids = sidecarJson ? parseBidsTiming(sidecarJson, nt) : null;
  if (bids) return { frames, ...bids, timeSource: "bids" };
  // pixdim[4] with xyzt_units (time bits 0x38: 8 = s, 16 = ms, 24 = µs); minutes are not a NIfTI unit.
  const tr = view.getFloat32(92, true);
  const unit = view.getUint8(123) & 0x38;
  const step = tr > 0 ? (unit === 16 ? tr / 1000 : unit === 24 ? tr / 1e6 : tr) : 60;
  return {
    frames,
    start: frames.map((_, i) => i * step),
    duration: frames.map(() => step),
    timeSource: "nifti",
    note: tr > 0 ? "Frame-Zeiten aus pixdim[4] (gleich lange Frames) – bitte prüfen oder Tabelle anpassen." : "Keine Frame-Zeiten im NIfTI – bitte Tabelle eingeben (oder BIDS-JSON mitladen).",
  };
}

export async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
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
  // NIfTI x-fastest (Fortran order) matches Volume3D (z*ny+y)*nx+x layout — no reorder needed.
  // Only the first 3D volume is read.
  const data = readNiftiValues(buffer, littleEndian, datatype, voxOffset, n);
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

/** Reads `count` voxel values (any supported datatype, little endian) as float32. */
function readNiftiValues(buffer: ArrayBuffer, littleEndian: boolean, datatype: number, voxOffset: number, count: number): Float32Array {
  const data = new Float32Array(count);
  if (datatype !== 2 && !littleEndian) throw new VolumeLoadError("Big-Endian NIfTI wird nicht unterstützt.");
  const bytes = (size: number) => buffer.slice(voxOffset, voxOffset + count * size);
  let src: ArrayLike<number>;
  switch (datatype) {
    case 2:
      src = new Uint8Array(buffer, voxOffset, Math.min(count, buffer.byteLength - voxOffset));
      break;
    case 4:
      src = new Int16Array(bytes(2));
      break;
    case 512:
      src = new Uint16Array(bytes(2));
      break;
    case 8:
      src = new Int32Array(bytes(4));
      break;
    case 16:
      src = new Float32Array(bytes(4));
      break;
    case 64:
      src = new Float64Array(bytes(8));
      break;
    default:
      throw new VolumeLoadError(`NIfTI-Datentyp ${datatype} wird nicht unterstützt.`);
  }
  const m = Math.min(count, src.length);
  for (let i = 0; i < m; i++) data[i] = src[i];
  return data;
}

/** A NIfTI file with all its values (e.g. 5D deformation fields: dims [nx, ny, nz, 1, 3]). */
export interface NiftiAll {
  /** dim[1..dim[0]] */
  dims: number[];
  data: Float32Array;
  geometry: VolumeGeometry;
  intentCode: number;
  description: string;
}

/** Reads every value of a NIfTI-1 file (scaled), plus its 3D geometry and dimensions. */
export function readNiftiAll(buffer: ArrayBuffer): NiftiAll {
  const view = new DataView(buffer);
  const littleEndian = view.getInt32(0, true) === 348;
  if (!littleEndian) throw new VolumeLoadError("Nur Little-Endian-NIfTI-1 wird unterstützt.");
  const ndim = view.getInt16(40, true);
  const dims = Array.from({ length: Math.max(3, Math.min(7, ndim)) }, (_, i) => Math.max(1, view.getInt16(42 + 2 * i, true)));
  const count = dims.reduce((a, b) => a * b, 1);
  const datatype = view.getInt16(70, true);
  const voxOffset = Math.max(352, Math.round(view.getFloat32(108, true)));
  const data = readNiftiValues(buffer, true, datatype, voxOffset, count);
  const slope = view.getFloat32(112, true);
  const inter = view.getFloat32(116, true);
  if (slope !== 0 && Number.isFinite(slope) && (slope !== 1 || inter !== 0)) for (let i = 0; i < count; i++) data[i] = data[i] * slope + inter;
  const pixdim: Vec3 = [80, 84, 88].map((o) => Math.abs(view.getFloat32(o, true)) || 1) as Vec3;
  let description = "";
  for (let i = 148; i < 228; i++) {
    const c = view.getUint8(i);
    if (c === 0) break;
    description += String.fromCharCode(c);
  }
  return { dims, data, geometry: readNiftiGeometry(view, true, pixdim), intentCode: view.getInt16(68, true), description };
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
const IMPLICIT_VR_LE = "1.2.840.10008.1.2";

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

async function loadDicomVolume(input: File[]): Promise<LoadedVolume> {
  // Files without extension are common for DICOM; skip hidden files and DICOMDIR index files.
  const files = input.filter((f) => !f.name.startsWith(".") && f.name.toUpperCase() !== "DICOMDIR");
  if (files.length === 0) throw new VolumeLoadError("Keine Dateien ausgewählt.");
  // Tolerate non-image files in a folder (reports, text files …) as long as some files are images.
  const results = await Promise.allSettled(files.map(parseDicomFile));
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (ok.length === 0) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason instanceof Error ? first.reason : new VolumeLoadError("Keine lesbaren DICOM-Bilddateien gefunden.");
  }
  // Several series in one selection (e.g. a whole study folder): use the series with the most files.
  const bySeries = new Map<string, ParsedDicomFile[]>();
  for (const p of ok) {
    const uid = p.file.dataSet.string("x0020000e")?.trim() ?? "";
    const g = bySeries.get(uid);
    if (g) g.push(p);
    else bySeries.set(uid, [p]);
  }
  return buildDicomVolume([...bySeries.values()].sort((a, b) => b.length - a.length)[0]);
}

/** Builds one volume from the parsed files of a single series (sorted along the slice normal). */
/**
 * Dynamic PET series: the same slice positions repeat once per time frame. Splits the files into frames (k-th file
 * at each position, ordered by acquisition time / frame reference time / instance number), builds one volume per
 * frame and reads the frame timing. Null if the group is an ordinary 3D series.
 */
function buildDicomDynamic(parsed: ParsedDicomFile[]): LoadedVolume | null {
  const iop = parsed[0].iop;
  if (parsed.length < 4 || !iop || !parsed.every((p) => p.frames.length === 1 && p.positions?.length === 1)) return null;
  const normal = cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]);
  const byPos = new Map<string, ParsedDicomFile[]>();
  for (const p of parsed) {
    const k = dot(p.positions![0], normal).toFixed(2);
    const g = byPos.get(k);
    if (g) g.push(p);
    else byPos.set(k, [p]);
  }
  const nt = parsed.length / byPos.size;
  if (byPos.size === parsed.length || !Number.isInteger(nt) || [...byPos.values()].some((g) => g.length !== nt)) return null;
  const ds = (p: ParsedDicomFile) => p.file.dataSet;
  const str = (p: ParsedDicomFile, tag: string) => ds(p).string(tag)?.trim();
  const acq = (p: ParsedDicomFile) => parseDicomDateTime(str(p, "x00080022") ?? str(p, "x00080021") ?? str(p, "x00080020"), str(p, "x00080032"));
  const order = (p: ParsedDicomFile) => [acq(p) ?? 0, parseFloat(str(p, "x00541300") ?? "0") || 0, p.instanceNumber];
  for (const g of byPos.values())
    g.sort((a, b) => {
      const x = order(a), y = order(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
  const groups = [...byPos.values()];
  const frameFiles = Array.from({ length: nt }, (_, t) => groups.map((g) => g[t]));
  const vols = frameFiles.map((f) => buildDicomVolume(f));
  const frames = vols.map((v) => v.volume.data);
  // Timing: acquisition time of each frame relative to injection (or the first frame); duration from (0018,1242).
  const first = frameFiles[0][0];
  const rp = ds(first).elements["x00540016"]?.items?.[0]?.dataSet;
  const rpStr = (tag: string) => rp?.string(tag)?.trim();
  const dt = rpStr("x00181078");
  const injection = dt && dt.length >= 10 ? parseDicomDateTime(dt.slice(0, 8), dt.slice(8).replace(/[+-]\d{4}$/, "")) : parseDicomDateTime(str(first, "x00080021") ?? str(first, "x00080020"), rpStr("x00181072"));
  const starts = frameFiles.map((f) => Math.min(...f.map((p) => acq(p) ?? Infinity)));
  const duration = frameFiles.map((f) => (parseFloat(str(f[0], "x00181242") ?? "") || 0) / 1000);
  let start: number[];
  let note: string | undefined;
  const distinct = new Set(starts.filter(Number.isFinite)).size === nt;
  if (distinct) {
    const t0 = injection !== undefined && injection <= starts[0] ? injection : starts[0];
    start = starts.map((s) => (s - t0) / 1000);
    if (t0 === starts[0]) note = "Start relativ zum ersten Frame (Injektionszeit fehlt im Header).";
  } else {
    // Some systems write the series start into every frame: use the frame durations cumulatively.
    start = [];
    let acc = 0;
    for (const d of duration) {
      start.push(acc);
      acc += d;
    }
    note = "Frame-Startzeiten aus den Frame-Dauern aufsummiert (Aufnahmezeiten im Header identisch).";
  }
  if (duration.some((d) => !(d > 0))) {
    for (let i = 0; i < nt; i++) if (!(duration[i] > 0)) duration[i] = i + 1 < nt ? start[i + 1] - start[i] : duration[i - 1] ?? 60;
    note = (note ? note + " " : "") + "Frame-Dauer (0018,1242) fehlt teilweise – aus den Startzeiten abgeleitet.";
  }
  if (str(first, "x00541102") === "NONE") note = (note ? note + " " : "") + "Achtung: Daten sind laut Header nicht zerfallskorrigiert.";
  const mean = vols[0].volume.withData(meanOfFrames(frames, duration));
  return { volume: mean, source: vols[0].source, dynamic: { frames, start, duration, timeSource: "dicom", note } };
}

function buildDicomVolume(parsed: ParsedDicomFile[]): LoadedVolume {
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
      // Raw data set without Part-10 header: explicit VR if the first element carries a two-letter VR,
      // otherwise implicit VR little endian (common in older archives).
      const isVr = (c: number) => c >= 65 && c <= 90;
      const explicit = bytes.length > 6 && isVr(bytes[4]) && isVr(bytes[5]);
      return dicomParser.parseDicom(bytes, { TransferSyntaxUID: explicit ? EXPLICIT_VR_LE : IMPLICIT_VR_LE });
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
