import type { DataSet, Element } from "dicom-parser";
import { concatBytes } from "../export/bytes";
import { IMPLICIT_VR_LE, type ValueOverride, encodeElementBytes, formatDS, sequenceValue, stringValue } from "../export/dicomRewriter";
import type { HeaderEdit } from "./headerModel";

/** Radionuclides offered in the header editor (half-life in s, positron branching fraction). */
export interface Nuclide {
  id: string;
  /** SNOMED CT code (scheme SCT, DICOM CID 18/4020); missing → private code. */
  code?: string;
  /** DICOM code meaning (CID 4020 style, e.g. "^18^Fluorine"). */
  meaning: string;
  halfLifeSec: number;
  positronFraction: number;
  /** Human-readable half-life. */
  halfLifeText: string;
}

const min = 60, h = 3600, d = 86400;

/**
 * Physical data: half-lives after NNDC/DDEP, for the therapy nuclides (Lu-177, Tb-161, I-131, Y-90) after
 * ICRP Publication 107 so that the dosimetry uses one consistent decay data set; positron branching ratios.
 */
export const NUCLIDES: Nuclide[] = [
  { id: "F-18", code: "77004003", meaning: "^18^Fluorine", halfLifeSec: 109.77 * min, positronFraction: 0.9673, halfLifeText: "109,77 min" },
  { id: "C-11", code: "40565003", meaning: "^11^Carbon", halfLifeSec: 20.364 * min, positronFraction: 0.9975, halfLifeText: "20,364 min" },
  { id: "Cu-64", code: "3932008", meaning: "^64^Copper", halfLifeSec: 12.701 * h, positronFraction: 0.1752, halfLifeText: "12,701 h" },
  { id: "Ga-68", code: "35337001", meaning: "^68^Gallium", halfLifeSec: 67.71 * min, positronFraction: 0.8891, halfLifeText: "67,71 min" },
  { id: "Tc-99m", code: "72454006", meaning: "^99m^Technetium", halfLifeSec: 6.0067 * h, positronFraction: 0, halfLifeText: "6,0067 h" },
  { id: "I-123", code: "21572004", meaning: "^123^Iodine", halfLifeSec: 13.2235 * h, positronFraction: 0, halfLifeText: "13,2235 h" },
  { id: "I-131", code: "1368003", meaning: "^131^Iodine", halfLifeSec: 8.021 * d, positronFraction: 0, halfLifeText: "8,021 d" },
  { id: "Y-90", code: "14691008", meaning: "^90^Yttrium", halfLifeSec: 64.1 * h, positronFraction: 0.000032, halfLifeText: "64,1 h" },
  { id: "Lu-177", code: "447553000", meaning: "^177^Lutetium", halfLifeSec: 6.647 * d, positronFraction: 0, halfLifeText: "6,647 d" },
  { id: "Tb-161", meaning: "^161^Terbium", halfLifeSec: 6.906 * d, positronFraction: 0, halfLifeText: "6,906 d" },
];

/** Private coding scheme for nuclides without a SNOMED CT code in DICOM (Tb-161). */
export const NUCLIDE_SCHEME = "99RECON";

/** Code written to (0054,0300): SNOMED CT where DICOM defines one, else the private scheme. */
export function nuclideCode(n: Nuclide): { value: string; scheme: string; meaning: string } {
  return n.code ? { value: n.code, scheme: "SCT", meaning: n.meaning } : { value: n.id, scheme: NUCLIDE_SCHEME, meaning: n.meaning };
}

export const RP_SEQUENCE = "x00540016";

/** Nuclide edit stored as HeaderEdit (value = JSON). */
export interface NuclideChoice {
  nuclide: string;
  /** Radiopharmaceutical (0018,0031), optional. */
  radiopharmaceutical?: string;
}

export function nuclideEdit(choice: NuclideChoice): HeaderEdit {
  return { tag: RP_SEQUENCE, vr: "SQ", value: JSON.stringify(choice), scope: "all" };
}

export function readNuclideEdit(edits: HeaderEdit[] | undefined): NuclideChoice | null {
  const e = edits?.findLast((x) => x.tag === RP_SEQUENCE && x.vr === "SQ" && x.value);
  if (!e?.value) return null;
  try {
    const c = JSON.parse(e.value) as NuclideChoice;
    return NUCLIDES.some((n) => n.id === c.nuclide) ? c : null;
  } catch {
    return null;
  }
}

/** Nuclide information found in a header (first item of the Radiopharmaceutical Information Sequence). */
export function currentNuclide(ds: DataSet): { meaning?: string; halfLifeSec?: number; positronFraction?: number; radiopharmaceutical?: string; match?: Nuclide } {
  const rp = ds.elements[RP_SEQUENCE]?.items?.[0]?.dataSet;
  if (!rp) return {};
  const code = rp.elements["x00540300"]?.items?.[0]?.dataSet;
  const meaning = code?.string("x00080104")?.trim();
  const codeValue = code?.string("x00080100")?.trim();
  const hl = Number(rp.string("x00181075"));
  const pf = Number(rp.string("x00181076"));
  const halfLifeSec = Number.isFinite(hl) && hl > 0 ? hl : undefined;
  const match =
    NUCLIDES.find((n) => codeValue && n.code === codeValue) ??
    NUCLIDES.find((n) => meaning && n.meaning.toLowerCase() === meaning.toLowerCase()) ??
    (halfLifeSec ? NUCLIDES.find((n) => Math.abs(n.halfLifeSec - halfLifeSec) / n.halfLifeSec < 0.01) : undefined);
  return { meaning, halfLifeSec, positronFraction: Number.isFinite(pf) ? pf : undefined, radiopharmaceutical: rp.string("x00180031")?.trim() || undefined, match };
}

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "SV", "UC", "UN", "UR", "UT", "UV"]);

/** Raw bytes of an element (header + value, incl. the delimiter of undefined-length sequences). */
function rawElement(bytes: Uint8Array, el: Element, explicit: boolean): Uint8Array {
  const header = !explicit ? 8 : el.vr && LONG_VR.has(el.vr) ? 12 : 8;
  const end = el.dataOffset + el.length + (el.hadUndefinedLength ? 8 : 0);
  return bytes.subarray(el.dataOffset - header, end);
}

const tagNum = (t: string) => parseInt(t.slice(1), 16);

/**
 * Radiopharmaceutical Information Sequence with the chosen nuclide: radionuclide code (0054,0300), half-life
 * (0018,1075), positron fraction (0018,1076) and optionally the radiopharmaceutical (0018,0031) are replaced; all
 * other elements of the first item (dose, injection time …) and further items are kept byte for byte.
 */
export function radiopharmaceuticalSequence(file: { bytes: Uint8Array; dataSet: DataSet; transferSyntax?: string }, choice: NuclideChoice): ValueOverride {
  const n = NUCLIDES.find((x) => x.id === choice.nuclide);
  if (!n) throw new Error(`Unbekanntes Nuklid ${choice.nuclide}.`);
  const explicit = file.transferSyntax !== IMPLICIT_VR_LE;
  const seq = file.dataSet.elements[RP_SEQUENCE];
  const items = seq?.items ?? [];
  const first = items[0]?.dataSet;
  const replaced = new Set(["x00540300", "x00181075", "x00181076", ...(choice.radiopharmaceutical !== undefined ? ["x00180031"] : [])]);

  const parts: { tag: number; bytes: Uint8Array }[] = [];
  if (first)
    for (const el of Object.values(first.elements)) {
      if (replaced.has(el.tag) || el.tag.startsWith("xfffe")) continue;
      parts.push({ tag: tagNum(el.tag), bytes: rawElement(file.bytes, el, explicit) });
    }
  const c = nuclideCode(n);
  const codeItem = concatBytes([
    encodeElementBytes(0x0008, 0x0100, stringValue("SH", c.value), explicit),
    encodeElementBytes(0x0008, 0x0102, stringValue("SH", c.scheme), explicit),
    encodeElementBytes(0x0008, 0x0104, stringValue("LO", c.meaning), explicit),
  ]);
  parts.push({ tag: 0x00540300, bytes: encodeElementBytes(0x0054, 0x0300, sequenceValue([codeItem]), explicit) });
  parts.push({ tag: 0x00181075, bytes: encodeElementBytes(0x0018, 0x1075, stringValue("DS", formatDS(Number(n.halfLifeSec.toPrecision(8)))), explicit) });
  parts.push({ tag: 0x00181076, bytes: encodeElementBytes(0x0018, 0x1076, stringValue("DS", formatDS(n.positronFraction)), explicit) });
  if (choice.radiopharmaceutical) parts.push({ tag: 0x00180031, bytes: encodeElementBytes(0x0018, 0x0031, stringValue("LO", choice.radiopharmaceutical.slice(0, 64)), explicit) });
  parts.sort((a, b) => a.tag - b.tag);

  const rest = items.slice(1).map((it) => file.bytes.subarray(it.dataOffset, it.dataOffset + it.length));
  return sequenceValue([concatBytes(parts.map((p) => p.bytes)), ...rest]);
}

/** Half-life after a pending nuclide edit (for SUV), else undefined. */
export function editedHalfLife(edits: HeaderEdit[] | undefined): number | undefined {
  const c = readNuclideEdit(edits);
  return c ? NUCLIDES.find((n) => n.id === c.nuclide)?.halfLifeSec : undefined;
}
