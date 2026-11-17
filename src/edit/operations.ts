import type { Volume3D } from "../viewer/volume";

/** A single volume edit. Discriminated union so further operations can be added later. */
export type EditOp = { type: "thresholdReplace"; threshold: number; value: number };

export interface EditResult {
  volume: Volume3D;
  /** Number of voxels whose value was changed by the operation. */
  affected: number;
}

/** Applies an edit to a volume, returning a new volume; the input is never modified. */
export function applyEdit(volume: Volume3D, op: EditOp): EditResult {
  switch (op.type) {
    case "thresholdReplace":
      return thresholdReplace(volume, op.threshold, op.value);
  }
}

/** Number of voxels the operation would touch (voxels already equal to the target are not counted). */
export function countAffected(volume: Volume3D, op: EditOp): number {
  switch (op.type) {
    case "thresholdReplace": {
      const { data } = volume;
      const target = Math.fround(op.value);
      let n = 0;
      for (let i = 0; i < data.length; i++) if (data[i] >= op.threshold && data[i] !== target) n++;
      return n;
    }
  }
}

function thresholdReplace(volume: Volume3D, threshold: number, value: number): EditResult {
  const src = volume.data;
  const out = new Float32Array(src);
  const target = Math.fround(value);
  let affected = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] >= threshold && out[i] !== target) {
      out[i] = target;
      affected++;
    }
  }
  return { volume: volume.withData(out), affected };
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
  switch (op.type) {
    case "thresholdReplace":
      return `Werte >= ${fmt(op.threshold * unit.scale)}${u} auf ${fmt(op.value * unit.scale)}${u} gesetzt`;
  }
}
