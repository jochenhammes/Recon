import type { AtlasInfo } from "./atlas";

/**
 * Label images in NIfTI: Recon Studio marks exported label atlases with intent_code NIFTI_INTENT_LABEL
 * (1002) and stores the label table as JSON in a header extension (ecode 6, NIFTI_ECODE_COMMENT). On load
 * this is recognized again, as are label tables of other tools (Caret/GIfTI XML LabelTable extension, as
 * written by TotalSegmentator) and label images recognizable by their file name (…_dseg, …_seg, aseg …).
 */
export const NIFTI_INTENT_LABEL = 1002;
export const NIFTI_ECODE_COMMENT = 6;
const JSON_KEY = "reconStudioAtlas";

/** NIfTI extension block (4-byte extender + one extension of `payload`, padded to a multiple of 16). */
export function atlasExtension(atlas: AtlasInfo): Uint8Array {
  const json = JSON.stringify({ [JSON_KEY]: { name: atlas.name, attribution: atlas.attribution, labels: Object.fromEntries([...atlas.labels].sort((a, b) => a[0] - b[0])) } });
  const payload = new TextEncoder().encode(json);
  const esize = Math.ceil((payload.length + 8) / 16) * 16;
  const out = new Uint8Array(4 + esize);
  const dv = new DataView(out.buffer);
  out[0] = 1; // extender: extensions follow
  dv.setInt32(4, esize, true);
  dv.setInt32(8, NIFTI_ECODE_COMMENT, true);
  out.set(payload, 12);
  return out;
}

/** Extensions (code, bytes) in the header block (348-byte header + extensions up to vox_offset). */
export function niftiExtensions(headerBytes: Uint8Array, littleEndian = true): { code: number; content: Uint8Array }[] {
  const out: { code: number; content: Uint8Array }[] = [];
  if (headerBytes.length < 352 || headerBytes[348] === 0) return out;
  const dv = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  let o = 352;
  while (o + 8 <= headerBytes.length) {
    const esize = dv.getInt32(o, littleEndian);
    const code = dv.getInt32(o + 4, littleEndian);
    if (esize < 8 || o + esize > headerBytes.length) break;
    out.push({ code, content: headerBytes.subarray(o + 8, o + esize) });
    o += esize;
  }
  return out;
}

function decode(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** Caret / GIfTI XML label table: <Label Key="1" …><![CDATA[spleen]]></Label>. */
export function parseXmlLabelTable(xml: string): Map<number, string> {
  const labels = new Map<number, string>();
  const re = /<Label\b[^>]*\bKey\s*=\s*"(-?\d+)"[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*<\/Label>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const index = Number(m[1]);
    const name = (m[2] ?? m[3] ?? "").trim();
    if (index > 0 && name) labels.set(index, name);
  }
  return labels;
}

export interface NiftiLabelInfo {
  /** intent_code is NIFTI_INTENT_LABEL. */
  intentLabel: boolean;
  name?: string;
  attribution?: string;
  labels?: Map<number, string>;
}

/** Label information stored in a NIfTI header (intent and label-table extensions); null if none. */
export function niftiLabelInfo(headerBytes: Uint8Array, littleEndian = true): NiftiLabelInfo | null {
  if (headerBytes.length < 348) return null;
  const dv = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  const intentLabel = dv.getInt16(68, littleEndian) === NIFTI_INTENT_LABEL;
  const info: NiftiLabelInfo = { intentLabel };
  for (const ext of niftiExtensions(headerBytes, littleEndian)) {
    const text = decode(ext.content);
    if (text.includes(JSON_KEY)) {
      try {
        const j = JSON.parse(text)[JSON_KEY] as { name?: string; attribution?: string; labels?: Record<string, string> };
        info.name = j.name;
        info.attribution = j.attribution;
        info.labels = new Map(Object.entries(j.labels ?? {}).map(([k, v]) => [Number(k), String(v)] as [number, string]).filter(([k, v]) => k > 0 && v));
      } catch {
        /* not our extension after all */
      }
    } else if (/<Label\b/.test(text)) {
      const labels = parseXmlLabelTable(text);
      if (labels.size) info.labels = labels;
    }
  }
  return intentLabel || info.labels?.size ? info : null;
}

/** File names that usually denote label images (BIDS dseg, FreeSurfer aseg/aparc, segmentations, atlases). */
export const LABEL_FILE_NAME = /(^|[_.\-\s])(dseg|seg|segmentation|labels?|atlas|aseg|aparc[^.]*|parcellation|aal\d*\w*|cerebra)([_.\-\s]|$)/i;

/** True if every finite value is a non-negative integer and the image has at least one label > 0. */
export function looksLikeLabels(data: Float32Array, maxLabel = 65535): boolean {
  let any = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (v < 0 || v > maxLabel || v !== Math.round(v)) return false;
    if (v > 0) any = true;
  }
  return any;
}
