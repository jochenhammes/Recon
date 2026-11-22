import type { DataSet } from "dicom-parser";
import { crc32 } from "../export/zip";
import { listZip } from "../core/unzip";
import { Volume3D } from "../viewer/volume";
import { parseDicomBytes } from "../viewer/volumeLoader";

import { t } from "../i18n";
/**
 * Project file (.recon): a ZIP (stored) with `project.json` – the session state as JSON – and one binary entry
 * per typed array (voxel data, frames, DICOM file bytes, masks …). Volumes, typed arrays, Maps/Sets and DICOM data
 * sets are encoded generically, so all datasets (with registration, display, tags, atlas tables, templates,
 * dynamic frames, edits) and stored results survive. Shared arrays (e.g. original = current volume) are stored once.
 */

export const PROJECT_FORMAT = "recon-studio-project";
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = ".recon";

export class ProjectError extends Error {}

type TypedArray = Float32Array | Float64Array | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array;
const TYPED: Record<string, new (b: ArrayBuffer) => TypedArray> = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
};

function isDataSet(v: object): v is DataSet {
  return "elements" in v && "byteArray" in v && typeof (v as { string?: unknown }).string === "function";
}

/** Encodes a value to JSON-able form; binary payloads go to `blobs` (deduplicated by identity). */
export function encode(value: unknown, blobs: Uint8Array[]): unknown {
  const seenArrays = new Map<object, number>();
  const seenVolumes = new Map<Volume3D, number>();
  const volumes: unknown[] = [];
  const bin = (a: TypedArray): number => {
    let i = seenArrays.get(a);
    if (i === undefined) {
      i = blobs.length;
      blobs.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
      seenArrays.set(a, i);
    }
    return i;
  };
  const enc = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return typeof v === "function" || typeof v === "symbol" ? undefined : typeof v === "number" && !Number.isFinite(v) ? { $num: String(v) } : v;
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return { $ta: v.constructor.name, bin: bin(v as TypedArray) };
    if (v instanceof Volume3D) {
      let i = seenVolumes.get(v);
      if (i === undefined) {
        i = volumes.length;
        seenVolumes.set(v, i);
        volumes.push({ nz: v.nz, ny: v.ny, nx: v.nx, spacing: v.voxelSpacingMm, geometry: v.geometry, data: bin(v.data) });
      }
      return { $vol: i };
    }
    if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [enc(k), enc(x)]) };
    if (v instanceof Set) return { $set: [...v].map(enc) };
    if (Array.isArray(v)) return v.map(enc);
    if (isDataSet(v)) return { $dataset: bin(v.byteArray) };
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const e = enc(x);
      if (e !== undefined) out[k] = e;
    }
    return out;
  };
  const root = enc(value);
  return { root, volumes };
}

/** Inverse of `encode`. */
export function decode(encoded: { root: unknown; volumes: { nz: number; ny: number; nx: number; spacing: [number, number, number]; geometry: Volume3D["geometry"]; data: number }[] }, blobs: Uint8Array[]): unknown {
  const arrays = new Map<string, TypedArray>();
  const typed = (type: string, i: number): TypedArray => {
    const key = `${type}:${i}`;
    let a = arrays.get(key);
    if (!a) {
      const T = TYPED[type];
      if (!T) throw new ProjectError(t("Unbekannter Datentyp {type}.", { type }));
      const b = blobs[i];
      if (!b) throw new ProjectError(t("Binärdaten {i} fehlen.", { i }));
      // Entries read from the ZIP are fresh copies (offset 0): use their buffer directly, else copy (alignment).
      const whole = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength;
      a = new T((whole ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) as ArrayBuffer);
      arrays.set(key, a);
    }
    return a;
  };
  const vols = new Map<number, Volume3D>();
  const volume = (i: number) => {
    let v = vols.get(i);
    if (!v) {
      const d = encoded.volumes[i];
      v = new Volume3D(typed("Float32Array", d.data) as Float32Array, d.nz, d.ny, d.nx, d.spacing, d.geometry);
      vols.set(i, v);
    }
    return v;
  };
  const dec = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(dec);
    const o = v as Record<string, unknown>;
    if ("$num" in o) return Number(o.$num);
    if ("$ta" in o) return typed(o.$ta as string, o.bin as number);
    if ("$vol" in o) return volume(o.$vol as number);
    if ("$map" in o) return new Map((o.$map as [unknown, unknown][]).map(([k, x]) => [dec(k), dec(x)]));
    if ("$set" in o) return new Set((o.$set as unknown[]).map(dec));
    if ("$dataset" in o) return parseDicomBytes(typed("Uint8Array", o.$dataset as number) as Uint8Array);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = dec(x);
    return out;
  };
  return dec(encoded.root);
}

/** ZIP (stored) as a Blob from parts – no single big copy in memory. */
function zipBlob(entries: { name: string; bytes: Uint8Array }[], date = new Date()): Blob {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.bytes);
    const size = e.bytes.length;
    if (offset + size > 0xfffffff0) throw new ProjectError(t("Projekt größer als 4 GB – bitte weniger Datensätze speichern."));
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name as Uint8Array<ArrayBuffer>, e.bytes as Uint8Array<ArrayBuffer>);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as Uint8Array<ArrayBuffer>[]), end.buffer], { type: "application/zip" });
}

/** Serializes a session state into a project file. */
export function saveProject(state: unknown, meta: Record<string, unknown> = {}): Blob {
  const blobs: Uint8Array[] = [];
  const encoded = encode(state, blobs);
  const json = JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, saved: new Date().toISOString(), ...meta, state: encoded });
  return zipBlob([{ name: "project.json", bytes: new TextEncoder().encode(json) }, ...blobs.map((b, i) => ({ name: `bin/${i}.bin`, bytes: b }))]);
}

/** Reads a project file; returns the state given to saveProject. */
export async function loadProject(buffer: ArrayBuffer): Promise<{ state: unknown; meta: Record<string, unknown> }> {
  let entries;
  try {
    entries = listZip(buffer);
  } catch {
    throw new ProjectError(t("Keine Recon-Studio-Projektdatei."));
  }
  const main = entries.find((e) => e.name === "project.json");
  if (!main) throw new ProjectError(t("Keine Recon-Studio-Projektdatei (project.json fehlt)."));
  const doc = JSON.parse(new TextDecoder().decode(await main.read())) as { format?: string; version?: number; state: Parameters<typeof decode>[0] } & Record<string, unknown>;
  if (doc.format !== PROJECT_FORMAT) throw new ProjectError(t("Keine Recon-Studio-Projektdatei."));
  if (typeof doc.version !== "number" || doc.version > PROJECT_VERSION)
    throw new ProjectError(t("Projektdatei Version {version} ist neuer als diese App (Version {PROJECT_VERSION}) – bitte die App aktualisieren.", { version: doc.version, PROJECT_VERSION }));
  const blobs: Uint8Array[] = [];
  for (const e of entries) {
    const m = e.name.match(/^bin\/(\d+)\.bin$/);
    if (m) blobs[Number(m[1])] = await e.read();
  }
  const { state, ...meta } = doc;
  return { state: decode(state, blobs), meta };
}
