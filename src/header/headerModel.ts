import type { DataSet, Element } from "dicom-parser";
import { type TagOverrides, stringValue, usArrayValue } from "../export/dicomRewriter";
import { lookupTag } from "./dictionary";
import { RP_SEQUENCE, radiopharmaceuticalSequence, readNuclideEdit } from "./radionuclide";

/** One header row for display. */
export interface HeaderRow {
  tag: string;
  name: string;
  vr: string;
  /** Display value (text, numbers or a size note for binary data). */
  value: string;
  editable: boolean;
  /** Reason why the row cannot be edited (if not editable). */
  lockReason?: string;
  /** Sequence items, each a list of rows (read-only). */
  items?: HeaderRow[][];
}

/** A pending header change, applied on DICOM export. `value: null` deletes the element. */
export interface HeaderEdit {
  tag: string;
  vr: string;
  value: string | null;
  /** "all" = every file of the series, otherwise the file index. */
  scope: "all" | number;
}

export const TEXT_VRS = new Set(["AE", "AS", "CS", "DA", "DS", "DT", "IS", "LO", "LT", "PN", "SH", "ST", "TM", "UI", "UT", "UC", "UR"]);
const NUMBER_VRS = new Set(["US", "SS", "UL", "SL", "FL", "FD"]);
export const EDITABLE_VRS = new Set([...TEXT_VRS, "US"]);

/**
 * Tags managed by the app on export (pixel data and its description, geometry, instance identity,
 * meta header): editing them would make the file inconsistent.
 */
export function lockReason(tag: string): string | undefined {
  const group = tag.slice(1, 5);
  if (group === "0002") return "Datei-Metainformation wird beim Export erzeugt.";
  if (group === "7fe0") return "Pixeldaten.";
  if (group === "0028") return "Bildpixel-Beschreibung wird beim Export aus den Daten gesetzt.";
  if (["x00080018", "x0020000e", "x00200032", "x00200037", "x00200052", "x00200013", "x00280008"].includes(tag))
    return "Wird beim Export automatisch gesetzt (Identität/Geometrie).";
  if (["x00540080", "x00540081", "x00541330", "x00540022", "x52009229", "x52009230"].includes(tag)) return "Schicht-/Geometrieinformation.";
  return undefined;
}

function displayValue(ds: DataSet, el: Element, vr: string): string {
  if (el.tag === "x7fe00010") return `<Pixeldaten, ${el.length === 0xffffffff ? "komprimiert" : `${el.length} Bytes`}>`;
  if (el.length === 0) return "";
  try {
    if (NUMBER_VRS.has(vr)) {
      const size = vr === "US" || vr === "SS" ? 2 : vr === "FD" ? 8 : 4;
      const n = Math.floor(el.length / size);
      const read = (i: number) =>
        vr === "US" ? ds.uint16(el.tag, i) : vr === "SS" ? ds.int16(el.tag, i) : vr === "UL" ? ds.uint32(el.tag, i) : vr === "SL" ? ds.int32(el.tag, i) : vr === "FL" ? ds.float(el.tag, i) : ds.double(el.tag, i);
      const values = Array.from({ length: Math.min(n, 16) }, (_, i) => read(i));
      return values.join("\\") + (n > 16 ? ` … (${n} Werte)` : "");
    }
    if (TEXT_VRS.has(vr) || vr === "??") {
      const s = ds.string(el.tag) ?? "";
      // Implicit VR with unknown tag: show text only if it looks printable.
      if (vr === "??" && /[^\x20-\x7e -ÿ\\]/.test(s)) return `<${el.length} Bytes>`;
      return s.length > 200 ? `${s.slice(0, 200)} …` : s;
    }
  } catch {
    /* fall through to byte size */
  }
  return `<${el.length} Bytes>`;
}

/** Top-level (and nested, read-only) rows of a dataset in tag order. */
export function headerRows(ds: DataSet, explicitVr: boolean): HeaderRow[] {
  return Object.values(ds.elements)
    .sort((a, b) => (a.tag < b.tag ? -1 : 1))
    .map((el) => {
      const entry = lookupTag(el.tag);
      const vr = (explicitVr || el.tag.startsWith("x0002") ? el.vr : undefined) ?? entry?.vr ?? (el.items ? "SQ" : "??");
      const isSequence = vr === "SQ" || !!el.items;
      const reason = lockReason(el.tag) ?? (isSequence ? "Sequenzen sind nur lesbar." : !EDITABLE_VRS.has(vr) ? `VR ${vr} ist nicht editierbar.` : undefined);
      return {
        tag: el.tag,
        name: entry?.name ?? "",
        vr: isSequence ? "SQ" : vr,
        value: isSequence ? `${el.items?.length ?? 0} Element(e)` : displayValue(ds, el, vr),
        editable: !reason,
        lockReason: reason,
        items: el.items?.map((it) => (it.dataSet ? headerRows(it.dataSet, explicitVr) : [])),
      };
    });
}

const MAX_LENGTH: Record<string, number> = {
  AE: 16, AS: 4, CS: 16, DA: 8, DS: 16, DT: 26, IS: 12, LO: 64, PN: 64, SH: 16, TM: 14, UI: 64, ST: 1024, LT: 10240, UT: 1_000_000, UC: 1_000_000, UR: 1_000_000,
};
const SINGLE_VALUE = new Set(["ST", "LT", "UT", "UR"]);

/** Validates a value for a VR; returns an error message or null. Multi-values are separated by "\". */
export function validateValue(vr: string, value: string): string | null {
  if (vr === "US") {
    for (const p of value.split("\\")) if (!/^\d+$/.test(p.trim()) || Number(p) > 65535) return "Ganze Zahl 0–65535 erwartet.";
    return null;
  }
  const parts = SINGLE_VALUE.has(vr) ? [value] : value.split("\\");
  for (const p of parts) {
    const max = MAX_LENGTH[vr];
    if (max !== undefined && p.length > max) return `Höchstens ${max} Zeichen pro Wert (VR ${vr}).`;
    if ([...p].some((c) => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\r" && c !== "\t")) return "Steuerzeichen sind nicht erlaubt.";
    if (p === "") continue;
    switch (vr) {
      case "DA":
        if (!/^\d{8}$/.test(p)) return "Datum im Format JJJJMMTT erwartet.";
        break;
      case "TM":
        if (!/^\d{2}(\d{2}(\d{2}(\.\d{1,6})?)?)?$/.test(p)) return "Uhrzeit im Format HHMMSS(.ffffff) erwartet.";
        break;
      case "DS":
        if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(p)) return "Dezimalzahl erwartet.";
        break;
      case "IS":
        if (!/^\s*[+-]?\d+\s*$/.test(p)) return "Ganze Zahl erwartet.";
        break;
      case "UI":
        if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/.test(p)) return "UID aus Ziffern und Punkten erwartet (ohne führende Nullen).";
        break;
      case "CS":
        if (!/^[A-Z0-9 _]*$/.test(p)) return "Nur Großbuchstaben, Ziffern, Leerzeichen und _ erlaubt.";
        break;
      case "AS":
        if (!/^\d{3}[DWMY]$/.test(p)) return "Alter im Format nnnD/W/M/Y erwartet (z. B. 056Y).";
        break;
    }
  }
  return null;
}

/** Applies header edits for one file (index) to an override map; locked tags are ignored. */
export function applyHeaderEdits(
  overrides: TagOverrides,
  edits: HeaderEdit[] | undefined,
  fileIndex: number,
  /** File the edits apply to (needed to rebuild sequences, e.g. the radionuclide). */
  file?: { bytes: Uint8Array; dataSet: DataSet; transferSyntax?: string },
): void {
  if (!edits) return;
  for (const e of edits) {
    if (e.scope !== "all" && e.scope !== fileIndex) continue;
    if (lockReason(e.tag)) continue;
    if (e.vr === "SQ") {
      // Radionuclide: rebuild the Radiopharmaceutical Information Sequence of this file.
      const choice = e.tag === RP_SEQUENCE && e.value ? readNuclideEdit([e]) : null;
      if (choice && file) overrides.set(e.tag, radiopharmaceuticalSequence(file, choice));
      continue;
    }
    if (e.value === null) overrides.set(e.tag, null);
    else if (e.vr === "US") overrides.set(e.tag, usArrayValue(e.value.split("\\").map((v) => Number(v.trim()))));
    else overrides.set(e.tag, stringValue(e.vr, e.value));
  }
}
