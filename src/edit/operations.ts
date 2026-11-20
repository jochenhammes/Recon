import type { Vec3 } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { gaussianSmooth } from "./filters";
import { cropVolume, flipVolume, resampleVolume, rotateVolume90 } from "./geometryOps";
import { type VoiShape, voiMask } from "./voi";

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
        return `Werte ≥ ${d(rule.threshold)} auf ${d(rule.value)} gesetzt`;
      case "le":
        return `Werte ≤ ${d(rule.threshold)} auf ${d(rule.value)} gesetzt`;
      case "range":
        return `Werte in [${d(rule.min)}, ${d(rule.max)}] auf ${d(rule.value)} gesetzt`;
      case "clip":
        return `Werte auf [${d(rule.min)}, ${d(rule.max)}] begrenzt`;
      case "linear":
        return `Werte × ${fmt(rule.a)} + ${d(rule.b)}`;
    }
  }
  switch (op.type) {
    case "voi": {
      const where = op.region === "inside" ? "innerhalb" : "außerhalb";
      const shape =
        op.voi.kind === "sphere"
          ? `Kugel r = ${fmt(op.voi.radius)} mm`
          : op.voi.kind === "box"
            ? `Quader ${op.voi.size.map(fmt).join(" × ")} mm`
            : "gezeichnete VOI";
      const action = op.action.kind === "set" ? `auf ${d(op.action.value)} gesetzt` : `× ${fmt(op.action.factor)}`;
      return `${shape}: Werte ${where} ${action}`;
    }
    case "gaussian":
      return `Gauß-Glättung, FWHM ${fmt(op.fwhmMm)} mm`;
    case "crop":
      return `Zugeschnitten auf ${op.max[0] - op.min[0] + 1} × ${op.max[1] - op.min[1] + 1} × ${op.max[2] - op.min[2] + 1} Voxel`;
    case "flip":
      return `Gespiegelt (${["Rechts↔Links", "Anterior↔Posterior", "Kopf↔Fuß"][op.patientAxis ?? op.axis]})`;
    case "rotate90":
      return `Um ${(((op.turns % 4) + 4) % 4) * 90}° gedreht (axial)`;
    case "resample":
      return `Resampling auf ${op.spacing.map(fmt).join(" × ")} mm`;
    default:
      return "Bearbeitung";
  }
}
