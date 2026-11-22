import { Volume3D } from "../viewer/volume";
import type { EditJob, EditJobResult } from "../workers/editJob";
import { type EditOp, applyEdit } from "./operations";

import { workerOptions } from "../i18n/lang";
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: EditJobResult) => void>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("../workers/edit.worker.ts", import.meta.url), workerOptions());
    worker.onmessage = (e: MessageEvent<EditJobResult>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  }
  return worker;
}

/**
 * Applies edits to a volume off the main thread (falls back to synchronous execution where workers
 * are unavailable, e.g. in tests). The input volume is not modified.
 */
export function runEdits(base: Volume3D, ops: EditOp[]): Promise<{ volume: Volume3D; affected: number }> {
  if (ops.length === 0) return Promise.resolve({ volume: base, affected: 0 });
  const w = getWorker();
  if (!w) {
    let volume = base;
    let affected = 0;
    for (const op of ops) ({ volume, affected } = applyEdit(volume, op));
    return Promise.resolve({ volume, affected });
  }
  const id = nextId++;
  const job: EditJob = { id, data: base.data, dims: [base.nx, base.ny, base.nz], geometry: base.geometry, ops };
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => {
      if (!r.ok) return reject(new Error(r.error));
      const [nx, ny, nz] = r.dims;
      const g = r.geometry;
      resolve({ volume: new Volume3D(r.data, nz, ny, nx, [g.spacing[2], g.spacing[1], g.spacing[0]], g), affected: r.affected });
    });
    w.postMessage(job);
  });
}
