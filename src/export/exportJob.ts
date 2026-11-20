import type { WorldToVoxel } from "../core/geometry";
import { umlaut, withPatientId } from "../core/exportName";
import { type Mat4, isIdentityMat4, worldToVoxelThrough } from "../core/transform";
import { datasetModality } from "../dataset/describe";
import type { LoadedDataset } from "../dataset/types";
import type { HeaderEdit } from "../header/headerModel";
import { changesGrid, describeEdit } from "../edit/operations";
import type { ReconParams } from "../recon/volume";
import { INTERPOLATION_LABELS, type Interpolation, type TargetGrid } from "../resample/resample";
import { runResample } from "../resample/runner";
import { Volume3D } from "../viewer/volume";
import type { AnonymizeOptions } from "./anonymize";
import { buildReconstructionDicom } from "./dicomWriter";
import { buildEditedDicomFiles } from "./editedDicomExport";
import { buildNiftiFile, buildNiftiFromOriginalHeader } from "./niftiWriter";
import { buildTemplateSeries } from "./templateDicomWriter";
import { buildZip } from "./zip";
import { derivedFrameOfReference } from "../registration/landmarks";

/** Header edits of a dataset plus the modality chosen in the app (0008,0060), if it differs from the header. */
export function headerEditsFor(d: LoadedDataset): HeaderEdit[] {
  const m = d.source.kind === "dicom" ? d.source.modality : undefined;
  if (!m || d.source.kind !== "dicom" || d.source.files[0].dataSet.string("x00080060")?.trim() === m) return d.headerEdits;
  return [...d.headerEdits.filter((e) => e.tag !== "x00080060"), { tag: "x00080060", vr: "CS", value: m, scope: "all" }];
}

/** Frame of reference written for a dataset: a new (deterministic) UID after an origin change. */
function frameOfReferenceFor(d: LoadedDataset): string | undefined {
  const uid = d.current.geometry.frameOfReferenceUid;
  return d.reoriented ? derivedFrameOfReference(uid, d.reoriented) : uid;
}

/** A dataset offered for export, with its placement in the reference world. */
export interface ExportItem {
  id: string;
  label: string;
  dataset: LoadedDataset;
  /** Native → reference world (registration). */
  matrix: Mat4;
  /** Reference world → voxel of this dataset. */
  w2v: WorldToVoxel;
  /** SUV factor (raw × factor = SUV), if the original DICOM allowed it. */
  suvFactor: number | null;
}

export type ExportSpace = { kind: "native" } | { kind: "resampled"; target: ExportItem; grid: TargetGrid; method: Interpolation };

export interface ExportSettings {
  format: "dicom" | "nifti";
  space: ExportSpace;
  /** NIfTI: store PET values as SUV where possible. */
  suv: boolean;
  anonymize?: AnonymizeOptions;
  markSeries: boolean;
  adjustWindow: boolean;
}

/** One exported file; `folder` groups the files of a DICOM series inside a ZIP. */
export interface OutFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  folder?: string;
}

const FILTER_LABELS: Record<string, string> = {
  ramp: "Ram-Lak",
  "shepp-logan": "Shepp-Logan",
  cosine: "Cosine",
  hamming: "Hamming",
  hann: "Hann",
  "hann-half": "Hann ×0,5",
  butterworth: "Butterworth",
};

function describeRecon(params: ReconParams | undefined): string {
  if (!params) return "SPECT-Rekonstruktion";
  return params.algorithm === "fbp" ? `FBP (${FILTER_LABELS[params.filterType] ?? params.filterType})` : `OSEM (${params.numSubsets} Subsets, ${params.numIterations} Iterationen)`;
}

export function safeName(s: string): string {
  return s.trim().replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "volume";
}

/** File base name of a dataset (without extension). */
export function baseNameFor(item: ExportItem, settings: ExportSettings, index: number): string {
  const d = item.dataset;
  if (settings.anonymize && settings.format === "dicom") return `${safeName(settings.anonymize.pseudonym) || "ANONYM"}_${safeName(datasetModality(d))}_${index + 1}`;
  const name = d.displayName.replace(/\.nii(\.gz)?$/i, "").replace(/\.(dcm|ima)$/i, "");
  const suffix = d.source.kind === "reconstruction" && !d.kindLabel && !d.derivedFrom ? (d.edits.length ? "_recon_edited" : "_recon") : d.edits.length ? "_edited" : "";
  return `${safeName(datasetModality(d))}_${safeName(name)}${suffix}`;
}

/** Whether SUV conversion applies to this dataset under the settings. */
export function suvApplies(item: ExportItem, settings: ExportSettings): boolean {
  return settings.format === "nifti" && settings.suv && !!item.suvFactor && !item.dataset.atlas;
}

/**
 * Files of one dataset: native grid (NIfTI with the registration in sform/qform; DICOM with the original geometry)
 * or resampled into the grid of a target dataset.
 */
export async function exportDatasetFiles(
  item: ExportItem,
  settings: ExportSettings,
  index: number,
  onProgress?: (f: number) => void,
): Promise<{ files: OutFile[]; warnings: string[] }> {
  const d = item.dataset;
  const base = baseNameFor(item, settings, index);
  const suv = suvApplies(item, settings);
  const niftiOpts = { atlas: d.atlas, valueScale: suv ? item.suvFactor! : undefined, description: suv ? "SUVbw (Recon Studio)" : undefined };
  const niftiName = `${base}${suv ? "_SUV" : ""}`;
  const warnings: string[] = [];

  if (settings.space.kind === "resampled") {
    const { target, grid, method } = settings.space;
    const w2v = worldToVoxelThrough(item.w2v, target.matrix);
    const data = await runResample(d.current, w2v, grid, d.atlas ? "nearest" : method, onProgress);
    const g = grid.geometry;
    const vol = new Volume3D(data, grid.nz, grid.ny, grid.nx, [g.spacing[2], g.spacing[1], g.spacing[0]], { ...g, frameOfReferenceUid: frameOfReferenceFor(target.dataset) });
    const spaceTag = `im_${safeName(datasetModality(target.dataset))}-Raum`;
    if (settings.format === "nifti" || d.source.kind !== "dicom") {
      if (settings.format === "dicom") warnings.push(`${item.label}: keine DICOM-Quelle – als NIfTI gespeichert.`);
      // The target's registration goes into the header, so all exported files share the reference world.
      return { files: [{ name: `${niftiName}_${spaceTag}.nii`, bytes: buildNiftiFile(vol, { ...niftiOpts, worldMatrix: target.matrix }) }], warnings };
    }
    const edits = d.edits.map((e) => describeEdit(e)).join("; ");
    const { files, warnings: w } = buildTemplateSeries(vol, d.source.files[0], {
      seriesDescription: `${datasetModality(d)} im ${datasetModality(target.dataset)}-Raum`,
      derivationDescription: `Resampelt in den Raum von ${target.dataset.displayName} (${INTERPOLATION_LABELS[method].split(" (")[0]})${edits ? `; ${edits}` : ""}`,
      frameOfReferenceUid: frameOfReferenceFor(target.dataset),
      anonymize: settings.anonymize,
      headerEdits: headerEditsFor(d),
    });
    return { files: series(files, `${base}_${spaceTag}`), warnings: [...warnings, ...w] };
  }

  // Native grid.
  const registered = !isIdentityMat4(item.matrix);
  if (settings.format === "nifti") {
    if (d.source.kind === "nifti" && !d.edits.some(changesGrid) && !d.atlas && !registered && !suv && !d.reoriented) {
      const bytes = buildNiftiFromOriginalHeader(d.current, d.source.nifti);
      if (bytes) return { files: [{ name: `${niftiName}.nii`, bytes }], warnings };
    }
    if (registered) warnings.push(`${item.label}: Registrierung im NIfTI-Header (sform), Voxel unverändert.`);
    return { files: [{ name: `${niftiName}.nii`, bytes: buildNiftiFile(d.current, { ...niftiOpts, worldMatrix: item.matrix }) }], warnings };
  }

  if (registered) warnings.push(`${item.label}: DICOM behält die Original-Lage – für deckungsgleiche DICOM-Dateien in den Raum der Basis resampeln.`);
  const source = d.source;
  const edited = d.edits.length > 0;
  const editDescription = d.edits.map((e) => describeEdit(e)).join("; ");
  if (source.kind === "dicom" && !d.edits.some(changesGrid) && !d.reoriented) {
    const { files, warnings: w } = buildEditedDicomFiles(d.current, source, {
      seriesDescriptionSuffix: settings.markSeries && edited ? " [bearbeitet]" : undefined,
      derivationDescription: edited ? editDescription : undefined,
      adjustWindow: edited && settings.adjustWindow,
      anonymize: settings.anonymize,
      headerEdits: headerEditsFor(d),
    });
    return { files: series(files, base), warnings: [...warnings, ...w] };
  }
  if (source.kind === "dicom") {
    const { files, warnings: w } = buildTemplateSeries(d.current, source.files[0], {
      seriesDescription: `${source.files[0].dataSet.string("x0008103e")?.trim() ?? ""} [bearbeitet]`.trim(),
      derivationDescription: [editDescription, d.reoriented ? "Koordinatenursprung neu gesetzt" : ""].filter(Boolean).join("; "),
      frameOfReferenceUid: frameOfReferenceFor(d),
      anonymize: settings.anonymize,
      headerEdits: headerEditsFor(d),
    });
    return { files: series(files, base), warnings: [...warnings, d.reoriented && !d.edits.some(changesGrid) ? `${item.label}: neue Serie mit neuem Koordinatenursprung (neue FrameOfReference).` : `${item.label}: neue Serie mit verändertem Voxelraster.`, ...w] };
  }
  const description = source.kind === "reconstruction" ? (d.kindLabel ? `${d.kindLabel} ${d.displayName}` : describeRecon(source.reconParams)) : `NIfTI-Import ${d.displayName}`;
  const bytes = buildReconstructionDicom(d.current, { seriesDescription: (edited ? `${description} [bearbeitet]` : description).slice(0, 64) });
  return { files: [{ name: `${base}.dcm`, bytes }], warnings: [...warnings, `${item.label}: DICOM ohne Original-Header (Secondary Capture).`] };
}

/** A DICOM series: one file as "<base>.dcm", several files in a folder "<base>/". */
function series(files: { name: string; bytes: Uint8Array<ArrayBuffer> }[], base: string): OutFile[] {
  return files.length === 1 ? [{ name: `${base}.dcm`, bytes: files[0].bytes }] : files.map((f) => ({ ...f, folder: base }));
}

/** Makes names unique (…_2, …_3) per folder level and adds the patient ID to NIfTI/CSV names. */
export function finalizeNames(files: OutFile[]): OutFile[] {
  const used = new Set<string>();
  const folderMap = new Map<string, string>();
  const unique = (name: string) => {
    let n = name;
    const dot = name.search(/\.(nii(\.gz)?|dcm|csv)$/i);
    const stem = dot >= 0 ? name.slice(0, dot) : name;
    const ext = dot >= 0 ? name.slice(dot) : "";
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${stem}_${i}${ext}`;
    used.add(n.toLowerCase());
    return n;
  };
  return files.map((f) => {
    if (f.folder) {
      let folder = folderMap.get(f.folder);
      if (!folder) {
        folder = unique(f.folder);
        folderMap.set(f.folder, folder);
      }
      return { ...f, folder };
    }
    return { ...f, name: unique(withPatientId(f.name)) };
  });
}

/** One file → itself; several → a ZIP (DICOM series in sub-folders). */
export function packageFiles(files: OutFile[], zipName: string): { name: string; bytes: Uint8Array<ArrayBuffer>; type: string } {
  const named = finalizeNames(files);
  if (named.length === 1 && !named[0].folder) {
    const f = named[0];
    return { name: f.name, bytes: f.bytes, type: f.name.endsWith(".dcm") ? "application/dicom" : "application/octet-stream" };
  }
  const entries = named.map((f) => ({ name: f.folder ? `${f.folder}/${f.name}` : f.name, bytes: f.bytes }));
  const hasNifti = named.some((f) => /\.nii$/i.test(f.name));
  return { name: hasNifti ? withPatientId(zipName, { archive: true }) : zipName, bytes: buildZip(entries), type: "application/zip" };
}
