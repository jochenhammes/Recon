import type { VolumeGeometry } from "../core/geometry";
import type { Mat4 } from "../core/transform";
import { Volume3D } from "../viewer/volume";
import type { Placed } from "../dosimetry/dose";
import type { DoseKernel } from "../dosimetry/setup";
import { densityMap, doseFromTia, voxelTia } from "../dosimetry/voxelDose";

/** A volume placed in the reference world, as plain data (Volume3D does not cross the worker boundary). */
export interface PlainPlaced {
  data: Float32Array;
  nx: number;
  ny: number;
  nz: number;
  geometry: VolumeGeometry;
  matrix: Mat4;
}

export interface VoxelDoseJob {
  type: "voxelDose";
  ref: PlainPlaced;
  timePoints: { spect: PlainPlaced; mbqPerCount: number; tH: number }[];
  ct?: PlainPlaced;
  physHalfLifeH: number;
  electronKeV: number;
  method: "trapezoid" | "mono";
  kernel?: DoseKernel;
}

export type DosimetryWorkerMessage =
  | { type: "progress"; stage: string; fraction: number }
  | { type: "result"; dose: Float32Array; /** Local-deposition map as well when a kernel was used (method comparison). */ led?: Float32Array }
  | { type: "error"; error: string };

const toPlaced = (p: PlainPlaced): Placed => {
  const g = p.geometry;
  return { volume: new Volume3D(p.data, p.nz, p.ny, p.nx, [g.spacing[2], g.spacing[1], g.spacing[0]], g), matrix: p.matrix };
};

self.onmessage = async (event: MessageEvent<VoxelDoseJob>) => {
  const post = (m: DosimetryWorkerMessage, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t ?? []);
  const job = event.data;
  try {
    const ref = toPlaced(job.ref);
    const tps = job.timePoints.map((t) => ({ spect: toPlaced(t.spect), mbqPerCount: t.mbqPerCount, tH: t.tH }));
    const tia = await voxelTia(ref, tps, {
      physHalfLifeH: job.physHalfLifeH,
      electronKeV: job.electronKeV,
      method: job.method,
      onProgress: (f) => post({ type: "progress", stage: "Zeitintegral", fraction: f }),
    });
    post({ type: "progress", stage: "Dichte", fraction: 0 });
    const rho = densityMap(ref, job.ct ? toPlaced(job.ct) : undefined);
    const led = doseFromTia(tia, rho, ref.volume, { electronKeV: job.electronKeV });
    if (!job.kernel) {
      post({ type: "result", dose: led }, [led.buffer]);
      return;
    }
    post({ type: "progress", stage: "Kernel-Faltung", fraction: 0 });
    const dose = doseFromTia(tia, rho, ref.volume, { electronKeV: job.electronKeV, kernel: job.kernel });
    post({ type: "result", dose, led }, [dose.buffer, led.buffer]);
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
