import type { DataSet, Element } from "dicom-parser";
import { concatBytes } from "./bytes";

export const IMPLICIT_VR_LE = "1.2.840.10008.1.2";
export const EXPLICIT_VR_LE = "1.2.840.10008.1.2.1";

/** VRs whose explicit-VR element header uses a 2-byte reserved field + 4-byte length (12-byte header). */
const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "SV", "UC", "UN", "UR", "UT", "UV"]);

/** Replacement value for one element (value bytes without header). */
export type ValueOverride = { vr: string; value: Uint8Array };

/**
 * Keeps an existing element byte-for-byte but overwrites bytes at absolute file offsets inside it
 * (same length, so all lengths stay valid) — used to replace values nested in sequences.
 */
export type PatchOverride = { patches: { offset: number; bytes: Uint8Array }[] };

/** Replacement, in-place patch, or null to delete the element. */
export type TagOverride = ValueOverride | PatchOverride | null;

/** Override map keyed by dicom-parser tag strings ("xGGGGEEEE", lower-case hex). */
export type TagOverrides = Map<string, TagOverride>;

export interface RewriteInput {
  bytes: Uint8Array;
  dataSet: DataSet;
  /** Original TransferSyntaxUID (undefined for a bare dataset without meta header). */
  transferSyntax?: string;
}

export function tagKey(group: number, element: number): string {
  return `x${group.toString(16).padStart(4, "0")}${element.toString(16).padStart(4, "0")}`;
}

function tagNumber(tag: string): number {
  return parseInt(tag.slice(1), 16);
}

function groupOf(tag: string): number {
  return parseInt(tag.slice(1, 5), 16);
}

/**
 * Re-serializes a DICOM file, copying every top-level element (including sequences, private tags,
 * preamble and any undefined-length encodings) byte-for-byte from the original, except the
 * elements named in `overrides`, which are replaced, deleted (null) or inserted in tag order.
 *
 * Dataset elements keep the original VR encoding (explicit or implicit little endian); meta header
 * (group 0002) elements are always explicit VR LE. (0002,0000) is recomputed, and retired group
 * length elements of other groups touched by an override are dropped.
 */
export function rewriteDicom(input: RewriteInput, overrides: TagOverrides): Uint8Array<ArrayBuffer> {
  const { bytes, dataSet } = input;
  const datasetExplicit = input.transferSyntax !== IMPLICIT_VR_LE;
  const hasMeta = input.transferSyntax !== undefined;

  const elements = Object.values(dataSet.elements)
    .map((el) => ({ el, start: el.dataOffset - headerLength(el, datasetExplicit) }))
    .sort((a, b) => a.start - b.start);
  if (elements.length === 0) throw new Error("DICOM-Datensatz enthält keine Elemente.");

  const touchedGroups = new Set([...overrides.keys()].map(groupOf));
  const pendingInserts = [...overrides.entries()]
    .filter(([tag, ov]) => ov !== null && "vr" in ov && !dataSet.elements[tag] && (hasMeta || groupOf(tag) !== 0x0002))
    .sort((a, b) => tagNumber(a[0]) - tagNumber(b[0]));

  const metaChunks: Uint8Array[] = [];
  const dataChunks: Uint8Array[] = [];
  const chunksFor = (tag: string) => (groupOf(tag) === 0x0002 ? metaChunks : dataChunks);
  const emitInsertsBefore = (tagNum: number) => {
    while (pendingInserts.length > 0 && tagNumber(pendingInserts[0][0]) < tagNum) {
      const [tag, ov] = pendingInserts.shift()!;
      if (ov && "vr" in ov) chunksFor(tag).push(encodeElement(tag, ov, groupOf(tag) === 0x0002 || datasetExplicit));
    }
  };

  const prefix = bytes.subarray(0, elements[0].start);

  for (let i = 0; i < elements.length; i++) {
    const { el, start } = elements[i];
    const end =
      i + 1 < elements.length
        ? elements[i + 1].start
        : el.length === 0xffffffff
          ? bytes.length
          : el.dataOffset + el.length;
    const tag = el.tag;
    const group = groupOf(tag);
    emitInsertsBefore(tagNumber(tag));

    if (tag === "x00020000") continue; // recomputed below
    if (group !== 0x0002 && (tagNumber(tag) & 0xffff) === 0 && touchedGroups.has(group)) continue;

    if (overrides.has(tag)) {
      const ov = overrides.get(tag)!;
      if (ov === null) continue;
      if ("vr" in ov) {
        chunksFor(tag).push(encodeElement(tag, ov, group === 0x0002 || datasetExplicit));
      } else {
        const copy = bytes.slice(start, end);
        for (const p of ov.patches) {
          if (p.offset < start || p.offset + p.bytes.length > end) throw new Error(`Patch außerhalb von ${tag}.`);
          copy.set(p.bytes, p.offset - start);
        }
        chunksFor(tag).push(copy);
      }
      continue;
    }
    chunksFor(tag).push(bytes.subarray(start, end));
  }
  emitInsertsBefore(Infinity);

  const metaBody = concatBytes(metaChunks);
  const metaHeader = hasMeta && metaBody.length > 0 ? [encodeElement("x00020000", { vr: "UL", value: u32le(metaBody.length) }, true)] : [];
  return concatBytes([prefix, ...metaHeader, metaBody, ...dataChunks]);
}

function headerLength(el: Element, datasetExplicit: boolean): number {
  const explicit = groupOf(el.tag) === 0x0002 || datasetExplicit;
  if (!explicit) return 8;
  return el.vr && LONG_VR.has(el.vr) ? 12 : 8;
}

function encodeElement(tag: string, ov: ValueOverride, explicit: boolean): Uint8Array {
  const n = tagNumber(tag);
  const group = (n >>> 16) & 0xffff;
  const elem = n & 0xffff;
  const value = ov.value.length % 2 === 0 ? ov.value : concatBytes([ov.value, Uint8Array.of(0)]);
  if (!explicit) return concatBytes([u16le(group), u16le(elem), u32le(value.length), value]);
  const vrBytes = Uint8Array.of(ov.vr.charCodeAt(0), ov.vr.charCodeAt(1));
  if (LONG_VR.has(ov.vr)) return concatBytes([u16le(group), u16le(elem), vrBytes, u16le(0), u32le(value.length), value]);
  if (value.length > 0xffff) throw new Error(`Wert für ${tag} (${ov.vr}) ist zu lang.`);
  return concatBytes([u16le(group), u16le(elem), vrBytes, u16le(value.length), value]);
}

export function u16le(v: number): Uint8Array {
  return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff);
}

export function u32le(v: number): Uint8Array {
  return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

/** Encodes a string value, padded to even length (UI with NUL, everything else with space). */
export function stringValue(vr: string, s: string): { vr: string; value: Uint8Array } {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length % 2 === 0) return { vr, value: bytes };
  return { vr, value: concatBytes([bytes, Uint8Array.of(vr === "UI" ? 0 : 0x20)]) };
}

export function usValue(v: number): { vr: string; value: Uint8Array } {
  return { vr: "US", value: u16le(v) };
}

/** Formats a number as a DICOM Decimal String (max. 16 characters). */
export function formatDS(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  for (let p = 15; p >= 1; p--) {
    let s = v.toPrecision(p);
    if (s.includes("e")) s = s.replace(/\.?0+e/, "e");
    else if (s.includes(".")) s = s.replace(/\.?0+$/, "");
    if (s.length <= 16) return s;
  }
  return v.toExponential(6);
}
