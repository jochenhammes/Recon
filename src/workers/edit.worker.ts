import { applyEdit } from "../edit/operations";
import type { EditJob, EditJobResult } from "./editJob";
import { Volume3D } from "../viewer/volume";

self.onmessage = (event: MessageEvent<EditJob>) => {
  const { id, data, dims, geometry, ops } = event.data;
  try {
    let volume = new Volume3D(data, dims[2], dims[1], dims[0], [geometry.spacing[2], geometry.spacing[1], geometry.spacing[0]], geometry);
    let affected = 0;
    for (const op of ops) {
      const r = applyEdit(volume, op);
      volume = r.volume;
      affected = r.affected;
    }
    const out = volume.data;
    const result: EditJobResult = { id, ok: true, data: out, dims: [volume.nx, volume.ny, volume.nz], geometry: volume.geometry, affected };
    (self as unknown as Worker).postMessage(result, [out.buffer]);
  } catch (e) {
    const result: EditJobResult = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
    (self as unknown as Worker).postMessage(result);
  }
};
