/** Shared test helpers: a minimal Part10 DICOM builder and byte-level inspection utilities. */
import * as dicomParser from "dicom-parser";
import { concatBytes } from "../export/bytes";
import { IMPLICIT_VR_LE, formatDS, stringValue, u16le, u32le } from "../export/dicomRewriter";

export const LONG_VR = new Set(["OB", "OW", "SQ", "UN", "UT"]);

export interface El {
  tag: [number, number];
  vr: string;
  value: Uint8Array;
  undefinedLength?: boolean;
}

export function enc(el: El, explicit: boolean): Uint8Array {
  const head = [u16le(el.tag[0]), u16le(el.tag[1])];
  const len = el.undefinedLength ? 0xffffffff : el.value.length;
  const tail = el.undefinedLength ? [u16le(0xfffe), u16le(0xe0dd), u32le(0)] : [];
  if (!explicit) return concatBytes([...head, u32le(len), el.value, ...tail]);
  const vr = Uint8Array.of(el.vr.charCodeAt(0), el.vr.charCodeAt(1));
  if (LONG_VR.has(el.vr)) return concatBytes([...head, vr, u16le(0), u32le(len), el.value, ...tail]);
  return concatBytes([...head, vr, u16le(len), el.value]);
}

export const s = (vr: string, v: string) => stringValue(vr, v).value;

export function item(content: Uint8Array): Uint8Array {
  return concatBytes([u16le(0xfffe), u16le(0xe000), u32le(content.length), content]);
}

export interface FileSpec {
  rows: number;
  cols: number;
  frames: number;
  pixels: number[];
  transferSyntax?: string;
  slope?: number;
  intercept?: number;
  instanceNumber?: number;
  pixelRepresentation?: number;
  bitsAllocated?: number;
  extra?: El[];
}

/** Builds a Part10 DICOM with meta header, a private tag, an undefined-length sequence and a defined-length sequence. */
export function buildPart10(spec: FileSpec): Uint8Array<ArrayBuffer> {
  const ts = spec.transferSyntax ?? "1.2.840.10008.1.2.1";
  const explicit = ts !== IMPLICIT_VR_LE;
  const bits = spec.bitsAllocated ?? 16;
  const pixelBytes = new Uint8Array(spec.pixels.length * (bits / 8));
  const dv = new DataView(pixelBytes.buffer);
  spec.pixels.forEach((p, i) => {
    if (bits === 8) dv.setUint8(i, p);
    else if (spec.pixelRepresentation === 1) dv.setInt16(i * 2, p, true);
    else dv.setUint16(i * 2, p, true);
  });
  const seqItem = item(enc({ tag: [0x0054, 0x0200], vr: "DS", value: s("DS", "90") }, explicit));

  const meta = concatBytes(
    [
      { tag: [0x0002, 0x0001], vr: "OB", value: Uint8Array.of(0, 1) },
      { tag: [0x0002, 0x0002], vr: "UI", value: s("UI", "1.2.840.10008.5.1.4.1.1.20") },
      { tag: [0x0002, 0x0003], vr: "UI", value: s("UI", "1.2.3.4.5.6") },
      { tag: [0x0002, 0x0010], vr: "UI", value: s("UI", ts) },
    ].map((e) => enc(e as El, true)),
  );
  const elements: El[] = [
    { tag: [0x0008, 0x0008], vr: "CS", value: s("CS", "ORIGINAL\\PRIMARY\\RECON TOMO") },
    { tag: [0x0008, 0x0018], vr: "UI", value: s("UI", "1.2.3.4.5.6") },
    { tag: [0x0008, 0x0060], vr: "CS", value: s("CS", "NM") },
    { tag: [0x0008, 0x103e], vr: "LO", value: s("LO", "SPECT AC") },
    { tag: [0x0010, 0x0010], vr: "PN", value: s("PN", "Doe^Jane") },
    { tag: [0x0020, 0x000d], vr: "UI", value: s("UI", "1.2.3.100") },
    { tag: [0x0020, 0x000e], vr: "UI", value: s("UI", "1.2.3.200") },
    { tag: [0x0020, 0x0013], vr: "IS", value: s("IS", String(spec.instanceNumber ?? 1)) },
    { tag: [0x0028, 0x0002], vr: "US", value: u16le(1) },
    { tag: [0x0028, 0x0008], vr: "IS", value: s("IS", String(spec.frames)) },
    { tag: [0x0028, 0x0010], vr: "US", value: u16le(spec.rows) },
    { tag: [0x0028, 0x0011], vr: "US", value: u16le(spec.cols) },
    { tag: [0x0028, 0x0030], vr: "DS", value: s("DS", "4.8\\4.8") },
    { tag: [0x0028, 0x0100], vr: "US", value: u16le(bits) },
    { tag: [0x0028, 0x0101], vr: "US", value: u16le(bits) },
    { tag: [0x0028, 0x0102], vr: "US", value: u16le(bits - 1) },
    { tag: [0x0028, 0x0103], vr: "US", value: u16le(spec.pixelRepresentation ?? 0) },
    { tag: [0x0028, 0x0106], vr: "US", value: u16le(Math.min(...spec.pixels)) },
    { tag: [0x0028, 0x0107], vr: "US", value: u16le(Math.max(...spec.pixels)) },
    { tag: [0x0028, 0x0109], vr: "US", value: u16le(Math.max(...spec.pixels)) },
    { tag: [0x0028, 0x1050], vr: "DS", value: s("DS", "55") },
    { tag: [0x0028, 0x1051], vr: "DS", value: s("DS", "110") },
    ...(spec.slope !== undefined
      ? [
          { tag: [0x0028, 0x1052], vr: "DS", value: s("DS", formatDS(spec.intercept ?? 0)) } as El,
          { tag: [0x0028, 0x1053], vr: "DS", value: s("DS", formatDS(spec.slope)) } as El,
        ]
      : []),
    { tag: [0x0029, 0x0010], vr: "LO", value: s("LO", "VENDOR PRIVATE") },
    { tag: [0x0029, 0x1010], vr: "OB", value: Uint8Array.of(1, 2, 3, 4, 5, 6) },
    { tag: [0x0054, 0x0022], vr: "SQ", value: seqItem, undefinedLength: true },
    { tag: [0x0054, 0x0052], vr: "SQ", value: seqItem },
    { tag: [0x7fe0, 0x0010], vr: bits === 8 ? "OB" : "OW", value: pixelBytes },
  ];
  if (spec.extra) elements.push(...spec.extra);
  elements.sort((x, y) => x.tag[0] - y.tag[0] || x.tag[1] - y.tag[1]);
  const groupLength = enc({ tag: [0x0002, 0x0000], vr: "UL", value: u32le(meta.length) }, true);
  const preamble = new Uint8Array(128);
  const magic = Uint8Array.of(0x44, 0x49, 0x43, 0x4d);
  return concatBytes([preamble, magic, groupLength, meta, ...elements.map((e) => enc(e, explicit))]);
}

export function asFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name);
}

/** Raw bytes of a top-level element (header + value) located via dicom-parser. */
export function rawElement(bytes: Uint8Array, tag: string): Uint8Array {
  const ds = dicomParser.parseDicom(bytes);
  const el = ds.elements[tag];
  const all = Object.values(ds.elements).sort((a, b) => a.dataOffset - b.dataOffset);
  const idx = all.indexOf(el);
  const header = el.vr && LONG_VR.has(el.vr) ? 12 : 8;
  const end = idx + 1 < all.length ? all[idx + 1].dataOffset - (all[idx + 1].vr && LONG_VR.has(all[idx + 1].vr!) ? 12 : 8) : bytes.length;
  return bytes.slice(el.dataOffset - header, end);
}

