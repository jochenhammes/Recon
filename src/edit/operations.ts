import type { Vec3 } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { gaussianSmooth } from "./filters";
import { cropVolume, flipVolume, resampleVolume, rotateVolume90 } from "./geometryOps";
import { type VoiShape, voiMask } from "./voi";

import { t } from "../i18n";
/** Per-voxel value rule (raw units). */
export type ValueRule =
  | { kind: "ge"; threshold: number; value: number }
  | { kind: "le"; threshold: number; value: number }
  | { kind: "range"; min: number; max: number; value: number }
  | { kind: "clip"; min: number; max: number }
  | { kind: "linear"; a: number; b: number };

export type VoiAction = { kind: "set"; value: number } | { kind: "scale"; factor: number };

/**
 * A volume edit. All operations are deterministic and serializable, so the current state can be
 * recomputed from the original by replaying the list (undo) and the work can run in a worker.
 */
export type EditOp =
  | { type: "thresholdReplace"; threshold: number; value: number }
  | { type: "value"; rule: ValueRule }
  | { type: "voi"; voi: VoiShape; region: "inside" | "outside"; action: VoiAction }
  | { type: "gaussian"; fwhmMm: number }
  | { type: "crop"; min: Vec3; max: Vec3 }
  | { type: "flip"; axis: 0 | 1 | 2; patientAxis?: 0 | 1 | 2; shift?: Vec3; group?: string }
  | { type: "rotate90"; turns: number; shift?: Vec3; group?: string }
  | { type: "resample"; spacing: Vec3; nearest?: boolean; group?: string };

export interface EditResult {
  volume: Volume3D;
  /** Number of voxels whose value was changed (value/VOI ops), or the voxel count otherwise. */
  affected: number;
}

/** True for operations that change the voxel grid (dimensions / voxel size / orientation). */
export function changesGrid(op: EditOp): boolean {
  return op.type === "crop" || op.type === "rotate90" || op.type === "resample";
}

function ruleFn(rule: ValueRule): (v: number) => number {
  switch (rule.kind) {
    case "ge":
      return (v) => (v >= rule.threshold ? rule.value : v);
    case "le":
      return (v) => (v <= rule.threshold ? rule.value : v);
    case "range":
      return (v) => (v >= rule.min && v <= rule.max ? rule.value : v);
    case "clip":
      return (v) => (v < rule.min ? rule.min : v > rule.max ? rule.max : v);
    case "linear":
      return (v) => rule.a * v + rule.b;
  }
}

function asRule(op: EditOp): ValueRule | null {
  if (op.type === "thresholdReplace") return { kind: "ge", threshold: op.threshold, value: op.value };
  if (op.type === "value") return op.rule;
  return null;
}

/** Applies an edit to a volume, returning a new volume; the input is never modified. */
export function applyEdit(volume: Volume3D, op: EditOp): EditResult {
  const rule = asRule(op);
  if (rule) return mapValues(volume, ruleFn(rule), null, true);
  switch (op.type) {
    case "voi": {
      const mask = voiMask(volume, op.voi);
      const action = op.action;
      const f = action.kind === "set" ? () => action.value : (v: number) => v * action.factor;
      return mapValues(volume, f, mask, op.region === "inside");
    }
    case "gaussian":
      return { volume: volume.withData(gaussianSmooth(volume, op.fwhmMm)), affected: volume.data.length };
    case "crop": {
      const v = cropVolume(volume, op.min, op.max);
      return { volume: v, affected: v.data.length };
    }
    case "flip":
      return { volume: shifted(flipVolume(volume, op.axis), op.shift), affected: volume.data.length };
    case "rotate90":
      return { volume: shifted(rotateVolume90(volume, op.turns), op.shift), affected: volume.data.length };
    case "resample": {
      const v = resampleVolume(volume, op.spacing, op.nearest);
      return { volume: v, affected: v.data.length };
    }
    default:
      return { volume, affected: 0 };
  }
}

/** Moves the volume by `shift` (mm, world) – keeps a common mirror/rotation center for several datasets. */
function shifted(v: Volume3D, shift: Vec3 | undefined): Volume3D {
  if (!shift || shift.every((s) => Math.abs(s) < 1e-9)) return v;
  const g = v.geometry;
  return new Volume3D(v.data, v.nz, v.ny, v.nx, v.voxelSpacingMm, { ...g, origin: [g.origin[0] + shift[0], g.origin[1] + shift[1], g.origin[2] + shift[2]] });
}

/** Replays a list of edits on the original volume. */
export function applyEdits(original: Volume3D, ops: EditOp[]): Volume3D {
  return ops.reduce((v, op) => applyEdit(v, op).volume, original);
}

/**
 * Applies f to every voxel (or to voxels where mask == wantMask). Changes are counted after
 * float32 rounding, so voxels already at the target value are not counted.
 */
function mapValues(volume: Volume3D, f: (v: number) => number, mask: Uint8Array | null, wantMask: boolean): EditResult {
  const src = volume.data;
  const out = new Float32Array(src);
  let affected = 0;
  const want = wantMask ? 1 : 0;
  for (let i = 0; i < out.length; i++) {
    if (mask && mask[i] !== want) continue;
    const v = out[i];
    const nv = Math.fround(f(v));
    if (nv !== v && !(nv !== nv && v !== v)) {
      out[i] = nv;
      affected++;
    }
  }
  return { volume: volume.withData(out), affected };
}

/** Number of voxels the operation would change (value and VOI operations; others: null). */
export function countAffected(volume: Volume3D, op: EditOp): number | null {
  const rule = asRule(op);
  const { data } = volume;
  if (rule) {
    const f = ruleFn(rule);
    let n = 0;
    for (let i = 0; i < data.length; i++) if (Math.fround(f(data[i])) !== data[i]) n++;
    return n;
  }
  if (op.type === "voi") {
    const mask = voiMask(volume, op.voi);
    const want = op.region === "inside" ? 1 : 0;
    let n = 0;
    for (let i = 0; i < data.length; i++) {
      if (mask[i] !== want) continue;
      const nv = op.action.kind === "set" ? Math.fround(op.action.value) : Math.fround(data[i] * op.action.factor);
      if (nv !== data[i]) n++;
    }
    return n;
  }
  return null;
}

/** Display scaling for edit descriptions, e.g. SUV = raw × factor. */
export interface DisplayUnit {
  scale: number;
  label: string;
}

function fmt(v: number): string {
  return String(Number(v.toPrecision(6)));
}

export function describeEdit(op: EditOp, unit: DisplayUnit = { scale: 1, label: "" }): string {
  const u = unit.label ? ` ${unit.label}` : "";
  const d = (v: number) => `${fmt(v * unit.scale)}${u}`;
  const rule = asRule(op);
  if (rule) {
    switch (rule.kind) {
      case "ge":
        return t("Werte ≥ {v} auf {v2} gesetzt", { v: d(rule.threshold), v2: d(rule.value) });
      case "le":
        return t("Werte ≤ {v} auf {v2} gesetzt", { v: d(rule.threshold), v2: d(rule.value) });
      case "range":
        return t("Werte in [{v}, {v2}] auf {v3} gesetzt", { v: d(rule.min), v2: d(rule.max), v3: d(rule.value) });
      case "clip":
        return t("Werte auf [{v}, {v2}] begrenzt", { v: d(rule.min), v2: d(rule.max) });
      case "linear":
        return t("Werte × {v} + {v2}", { v: fmt(rule.a), v2: d(rule.b) });
    }
  }
  switch (op.type) {
    case "voi": {
      const where = op.region === "inside" ? "innerhalb" : t("außerhalb");
      const shape =
        op.voi.kind === "sphere"
          ? t("Kugel r = {v} mm", { v: fmt(op.voi.radius) })
          : op.voi.kind === "box"
            ? t("Quader {v} mm", { v: op.voi.size.map(fmt).join(" × ") })
            : "gezeichnete VOI";
      const action = op.action.kind === "set" ? t("auf {v} gesetzt", { v: d(op.action.value) }) : `× ${fmt(op.action.factor)}`;
      return t("{shape}: Werte {where} {action}", { shape, where, action });
    }
    case "gaussian":
      return t("Gauß-Glättung, FWHM {v} mm", { v: fmt(op.fwhmMm) });
    case "crop":
      return t("Zugeschnitten auf {v} × {v2} × {v3} Voxel", { v: op.max[0] - op.min[0] + 1, v2: op.max[1] - op.min[1] + 1, v3: op.max[2] - op.min[2] + 1 });
    case "flip":
      return t("Gespiegelt ({v})", { v: [t("Rechts↔Links"), "Anterior↔Posterior", t("Kopf↔Fuß")][op.patientAxis ?? op.axis] });
    case "rotate90":
      return t("Um {v}° gedreht (axial)", { v: (((op.turns % 4) + 4) % 4) * 90 });
    case "resample":
      return t("Resampling auf {v} mm", { v: op.spacing.map(fmt).join(" × ") });
    default:
      return "Bearbeitung";
  }
}
