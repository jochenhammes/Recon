import { useMemo, useState } from "react";
import type { Vec3, WorldToVoxel } from "../core/geometry";
import { type Mat4, worldToVoxelThrough } from "../core/transform";
import { modalityLabel } from "../dataset/describe";
import type { LoadedDataset } from "../dataset/types";
import { describeEdit } from "../edit/operations";
import type { AnonymizeOptions } from "../export/anonymize";
import type { ExportedFile } from "../export/editedDicomExport";
import { buildNiftiFile } from "../export/niftiWriter";
import { buildTemplateSeries } from "../export/templateDicomWriter";
import { buildZip } from "../export/zip";
import { INTERPOLATION_LABELS, type Interpolation, type TargetGrid, customGrid } from "../resample/resample";
import { runResample } from "../resample/runner";
import { Volume3D } from "../viewer/volume";
import { formatInput, parseInput } from "./format";

/** A loaded dataset with its placement in the reference world. */
export interface SpaceDataset {
  id: string;
  label: string;
  dataset: LoadedDataset;
  /** Native → reference world. */
  matrix: Mat4;
  /** Reference world → voxel of this dataset. */
  w2v: WorldToVoxel;
}

type GridMode = "target" | "matrix" | "voxel";

function safe(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9_.-]+/g, "_") || "volume";
}

function download(bytes: Uint8Array<ArrayBuffer>, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export interface SpaceExportProps {
  spaces: SpaceDataset[];
  /** Preselected source (active dataset). */
  activeId: string;
  anonymize?: AnonymizeOptions;
}

/**
 * Resamples one or more datasets (including edits and registration) into the voxel space of any
 * loaded dataset – optionally with a different matrix or voxel size – and exports DICOM or NIfTI.
 */
export function SpaceExport({ spaces, activeId, anonymize }: SpaceExportProps) {
  const [sources, setSources] = useState<string[]>([activeId]);
  const [targetId, setTargetId] = useState(spaces.find((s) => s.id !== activeId)?.id ?? activeId);
  const [mode, setMode] = useState<GridMode>("target");
  const [matrixText, setMatrixText] = useState<string[]>([]);
  const [voxelText, setVoxelText] = useState<string[]>([]);
  const [method, setMethod] = useState<Interpolation>("linear");
  const [format, setFormat] = useState<"dicom" | "nifti">("dicom");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const target = spaces.find((s) => s.id === targetId) ?? spaces[0];
  const tv = target.dataset.current;
  const baseGrid: TargetGrid = useMemo(() => ({ nx: tv.nx, ny: tv.ny, nz: tv.nz, geometry: tv.geometry }), [tv]);
  const matrixValues = (matrixText.length ? matrixText : [tv.nx, tv.ny, tv.nz].map(String)).map(parseInput) as Vec3;
  const voxelValues = (voxelText.length ? voxelText : tv.geometry.spacing.map((s) => formatInput(s))).map(parseInput) as Vec3;
  const grid: TargetGrid | null =
    mode === "target"
      ? baseGrid
      : mode === "matrix"
        ? matrixValues.every((v) => v >= 1)
          ? customGrid(baseGrid, { matrix: matrixValues })
          : null
        : voxelValues.every((v) => v > 0)
          ? customGrid(baseGrid, { voxelMm: voxelValues })
          : null;
  const selected = spaces.filter((s) => sources.includes(s.id));
  const dicomPossible = selected.every((s) => s.dataset.source.kind === "dicom");

  async function run() {
    if (!grid || selected.length === 0) return;
    setWorking(true);
    setError(null);
    try {
      const outputs: { name: string; files: ExportedFile[] }[] = [];
      for (const [i, s] of selected.entries()) {
        setStatus(`${i + 1}/${selected.length}: ${s.label} wird resampelt …`);
        // Source voxel for a point given in the target dataset's own coordinates.
        const w2v = worldToVoxelThrough(s.w2v, target.matrix);
        const data = await runResample(s.dataset.current, w2v, grid, method, (f) => setStatus(`${i + 1}/${selected.length}: ${s.label} ${Math.round(f * 100)} %`));
        const g = grid.geometry;
        const vol = new Volume3D(data, grid.nz, grid.ny, grid.nx, [g.spacing[2], g.spacing[1], g.spacing[0]], {
          ...g,
          frameOfReferenceUid: tv.geometry.frameOfReferenceUid,
        });
        const base = `${safe(modalityLabel(s.dataset.source))}_${safe(s.dataset.displayName)}_im_${safe(modalityLabel(target.dataset.source))}-Raum`;
        if (format === "nifti" || s.dataset.source.kind !== "dicom") {
          outputs.push({ name: base, files: [{ name: `${base}.nii`, bytes: buildNiftiFile(vol) }] });
        } else {
          const edits = s.dataset.edits.map((e) => describeEdit(e)).join("; ");
          const { files } = buildTemplateSeries(vol, s.dataset.source.files[0], {
            seriesDescription: `${modalityLabel(s.dataset.source)} im ${modalityLabel(target.dataset.source)}-Raum`,
            derivationDescription: `Resampelt in den Raum von ${target.dataset.displayName} (${INTERPOLATION_LABELS[method].split(" (")[0]})${edits ? `; ${edits}` : ""}`,
            frameOfReferenceUid: tv.geometry.frameOfReferenceUid,
            anonymize,
            headerEdits: s.dataset.headerEdits,
          });
          outputs.push({ name: base, files });
        }
      }
      setStatus("Datei wird erstellt …");
      if (outputs.length === 1 && outputs[0].files.length === 1) {
        const f = outputs[0].files[0];
        download(f.bytes, f.name.endsWith(".nii") ? f.name : `${outputs[0].name}.dcm`, f.name.endsWith(".nii") ? "application/octet-stream" : "application/dicom");
      } else {
        const entries = outputs.flatMap((o) => (o.files.length === 1 && o.files[0].name.endsWith(".nii") ? o.files : o.files.map((f) => ({ name: `${o.name}/${f.name}`, bytes: f.bytes }))));
        download(buildZip(entries), outputs.length === 1 ? `${outputs[0].name}.zip` : `export_im_${safe(modalityLabel(target.dataset.source))}-Raum.zip`, "application/zip");
      }
      setStatus(`${selected.length} Datensatz/Datensätze exportiert (${grid.nx} × ${grid.ny} × ${grid.nz}).`);
    } catch (e) {
      setStatus(null);
      setError(`Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="card">
      <h3>In Zielraum exportieren / resampeln</h3>
      <div className="field">
        Datensätze
        {spaces.map((s) => (
          <label key={s.id} className="checkbox-field">
            <input
              type="checkbox"
              checked={sources.includes(s.id)}
              disabled={working}
              onChange={(e) => setSources((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))}
            />
            {s.label}
          </label>
        ))}
      </div>
      <label className="field">
        Zielraum (Raster von)
        <select
          value={target.id}
          disabled={working}
          onChange={(e) => {
            setTargetId(e.target.value);
            setMatrixText([]);
            setVoxelText([]);
          }}
        >
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} – {s.dataset.current.nx}×{s.dataset.current.ny}×{s.dataset.current.nz}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented-control" role="group" aria-label="Raster">
        {(
          [
            ["target", "wie Ziel"],
            ["matrix", "Matrix"],
            ["voxel", "Voxelgröße"],
          ] as [GridMode, string][]
        ).map(([m, l]) => (
          <button key={m} className={mode === m ? "active" : ""} disabled={working} onClick={() => setMode(m)}>
            {l}
          </button>
        ))}
      </div>
      {mode === "matrix" && (
        <div className="field-row three">
          {["x", "y", "z"].map((a, i) => (
            <label key={a} className="field">
              {a} (Voxel)
              <input
                type="text"
                inputMode="numeric"
                value={matrixText[i] ?? String([tv.nx, tv.ny, tv.nz][i])}
                onChange={(e) => {
                  const next = matrixText.length ? [...matrixText] : [tv.nx, tv.ny, tv.nz].map(String);
                  next[i] = e.target.value;
                  setMatrixText(next);
                }}
              />
            </label>
          ))}
        </div>
      )}
      {mode === "voxel" && (
        <div className="field-row three">
          {["x", "y", "z"].map((a, i) => (
            <label key={a} className="field">
              {a} (mm)
              <input
                type="text"
                inputMode="decimal"
                value={voxelText[i] ?? formatInput(tv.geometry.spacing[i])}
                onChange={(e) => {
                  const next = voxelText.length ? [...voxelText] : tv.geometry.spacing.map((s) => formatInput(s));
                  next[i] = e.target.value;
                  setVoxelText(next);
                }}
              />
            </label>
          ))}
        </div>
      )}
      {grid && (
        <p className="tool-hint">
          Ergebnis: {grid.nx} × {grid.ny} × {grid.nz} Voxel à {grid.geometry.spacing.map((s) => s.toFixed(2)).join(" × ")} mm im Sichtfeld von{" "}
          {target.label}.
        </p>
      )}
      <label className="field">
        Interpolation
        <select value={method} disabled={working} onChange={(e) => setMethod(e.target.value as Interpolation)}>
          {(Object.keys(INTERPOLATION_LABELS) as Interpolation[]).map((m) => (
            <option key={m} value={m}>
              {INTERPOLATION_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented-control" role="group" aria-label="Format">
        <button className={format === "dicom" ? "active" : ""} disabled={working || !dicomPossible} onClick={() => setFormat("dicom")}>
          DICOM
        </button>
        <button className={format === "nifti" ? "active" : ""} disabled={working} onClick={() => setFormat("nifti")}>
          NIfTI
        </button>
      </div>
      {!dicomPossible && format === "dicom" && <p className="tool-hint">Nicht-DICOM-Quellen werden als NIfTI exportiert.</p>}
      <p className="export-note">
        Bearbeitungen und Registrierung werden berücksichtigt. DICOM: Header des jeweiligen Quelldatensatzes als Vorlage, Geometrie und Frame of
        Reference des Zielraums.
      </p>
      <button className="primary-btn" disabled={working || !grid || selected.length === 0} onClick={() => void run()}>
        {working ? "Export läuft …" : "Exportieren"}
      </button>
      {status && <p className="tool-hint">{status}</p>}
      {error && <div className="error-banner">{error}</div>}
    </section>
  );
}
