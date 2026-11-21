import { acquisitionTime } from "../dataset/describe";
import type { LoadedDataset } from "../dataset/types";
import { dicomDateTime } from "./calibration";

/**
 * Grouping of the loaded datasets into acquisition sessions (one SPECT/PET with its CT and label maps per
 * measurement time point), from FrameOfReference, StudyInstanceUID and the acquisition date/time of the DICOM header.
 */

export type SessionRole = "functional" | "ct" | "label";

export interface SessionItem {
  id: string;
  role: SessionRole;
  /** Acquisition time (ms, local time of the header), if known. */
  acqMs?: number;
  frameOfReference?: string;
  studyUid?: string;
  /** For label maps: id of the dataset it was derived from (e.g. the CT of a "CT-Organe · <CT>" map). */
  parentId?: string;
  /** Label maps: organ map (CT segmentation) or other (lesions, own segmentation). */
  kind?: "organs" | "lesions" | "other";
}

export interface Session {
  /** Stable key (sorted ids of the members). */
  key: string;
  /** Acquisition time of the session (functional image, else earliest member). */
  acqMs?: number;
  functional: string[];
  cts: string[];
  organs: string[];
  lesions: string[];
  otherLabels: string[];
}

/** Datasets without a date and without a link to a session. */
export interface Grouping {
  sessions: Session[];
  unassigned: SessionItem[];
}

/** Images further apart than this are not one session unless they share a FrameOfReference. */
export const SESSION_WINDOW_MS = 90 * 60 * 1000;

/** Acquisition time (ms) of a dataset from its DICOM header (derived datasets: their source). */
export function acquisitionMs(d: Pick<LoadedDataset, "source" | "derivedFrom">): number | undefined {
  const a = acquisitionTime(d);
  return a ? dicomDateTime(a.date, a.time) : undefined;
}

export function studyUidOf(d: Pick<LoadedDataset, "source" | "derivedFrom">): string | undefined {
  const src = d.derivedFrom?.source ?? d.source;
  return src.kind === "dicom" ? src.files[0].dataSet.string("x0020000d")?.trim() || undefined : undefined;
}

/**
 * Groups items into sessions:
 * - same FrameOfReference → same session;
 * - else CT and functional image (or two CTs) within 90 min, and in the same study if both have one;
 * - two functional images with different FrameOfReference are never merged by time alone (separate time points);
 * - label maps follow their parent dataset, else their FrameOfReference.
 * Sessions are sorted by time; items without any link end up in `unassigned`.
 */
export function groupSessions(items: SessionItem[]): Grouping {
  const images = items.filter((i) => i.role !== "label");
  const parent = new Map<string, string>(images.map((i) => [i.id, i.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const hasFunctional = (root: string) => images.some((i) => i.role === "functional" && find(i.id) === root);

  for (let a = 0; a < images.length; a++)
    for (let b = a + 1; b < images.length; b++) {
      const x = images[a], y = images[b];
      if (x.frameOfReference && x.frameOfReference === y.frameOfReference) union(x.id, y.id);
    }
  // Time window: closest pairs first, never two functional images into one session.
  const pairs: [SessionItem, SessionItem, number][] = [];
  for (let a = 0; a < images.length; a++)
    for (let b = a + 1; b < images.length; b++) {
      const x = images[a], y = images[b];
      if (x.acqMs === undefined || y.acqMs === undefined) continue;
      const dt = Math.abs(x.acqMs - y.acqMs);
      if (dt > SESSION_WINDOW_MS) continue;
      if (x.studyUid && y.studyUid && x.studyUid !== y.studyUid) continue;
      pairs.push([x, y, dt]);
    }
  pairs.sort((p, q) => p[2] - q[2]);
  for (const [x, y] of pairs) {
    const rx = find(x.id), ry = find(y.id);
    if (rx === ry) continue;
    if (hasFunctional(rx) && hasFunctional(ry)) continue;
    union(x.id, y.id);
  }

  const groups = new Map<string, SessionItem[]>();
  for (const i of images) {
    const r = find(i.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  const unassigned: SessionItem[] = [];
  // Labels: parent first, then FrameOfReference.
  for (const l of items.filter((i) => i.role === "label")) {
    const via = (l.parentId && parent.has(l.parentId) ? find(l.parentId) : undefined) ?? images.find((i) => l.frameOfReference && i.frameOfReference === l.frameOfReference)?.id;
    if (via) groups.get(find(via))!.push(l);
    else unassigned.push(l);
  }

  const sessions: Session[] = [];
  for (const members of groups.values()) {
    const imgs = members.filter((m) => m.role !== "label");
    // A lone image without date or frame of reference cannot be placed in time.
    if (imgs.length === 1 && imgs[0].acqMs === undefined && members.length === 1) {
      unassigned.push(imgs[0]);
      continue;
    }
    const byTime = (a: SessionItem, b: SessionItem) => (a.acqMs ?? Infinity) - (b.acqMs ?? Infinity);
    const functional = members.filter((m) => m.role === "functional").sort(byTime);
    const times = (functional.length ? functional : imgs).map((m) => m.acqMs).filter((t): t is number => t !== undefined);
    sessions.push({
      key: members.map((m) => m.id).sort().join("+"),
      acqMs: times.length ? Math.min(...times) : undefined,
      functional: functional.map((m) => m.id),
      cts: members.filter((m) => m.role === "ct").sort(byTime).map((m) => m.id),
      organs: members.filter((m) => m.role === "label" && m.kind === "organs").map((m) => m.id),
      lesions: members.filter((m) => m.role === "label" && m.kind === "lesions").map((m) => m.id),
      otherLabels: members.filter((m) => m.role === "label" && m.kind !== "organs" && m.kind !== "lesions").map((m) => m.id),
    });
  }
  sessions.sort((a, b) => (a.acqMs ?? Infinity) - (b.acqMs ?? Infinity));
  return { sessions, unassigned };
}

/** Hours after injection, or undefined. */
export function hoursPi(acqMs: number | undefined, injectionMs: number | undefined): number | undefined {
  return acqMs !== undefined && injectionMs !== undefined ? (acqMs - injectionMs) / 3.6e6 : undefined;
}

/** "21.11.2026, 14:31" or "ohne Datum". */
export const fmtDateTime = (ms: number | undefined) =>
  ms === undefined ? "ohne Datum" : new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
