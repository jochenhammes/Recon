import { useState } from "react";
import type { RampFilterType } from "../recon/fft";
import type { ReconParams } from "../recon/volume";
import type { SpectProjectionSet } from "../dicom/types";

export interface ReconControlsProps {
  projectionSet: SpectProjectionSet;
  busy: boolean;
  progress: number | null;
  onStart: (params: ReconParams) => void;
  onCancel: () => void;
}

const FILTERS: { value: RampFilterType; label: string }[] = [
  { value: "ramp", label: "Ram-Lak (scharf, rauschreich)" },
  { value: "shepp-logan", label: "Shepp-Logan" },
  { value: "cosine", label: "Cosine" },
  { value: "hamming", label: "Hamming" },
  { value: "hann", label: "Hann (glatt)" },
  { value: "hann-half", label: "Hann ×0,5 (sehr weich)" },
  { value: "butterworth", label: "Butterworth (extra weich)" },
];

export function ReconControls({ projectionSet, busy, progress, onStart, onCancel }: ReconControlsProps) {
  const [algorithm, setAlgorithm] = useState<"fbp" | "osem">("fbp");
  const [filterType, setFilterType] = useState<RampFilterType>("hann");
  const [numSubsets, setNumSubsets] = useState(8);
  const [numIterations, setNumIterations] = useState(2);

  const numFrames = projectionSet.frames.length;
  const minAngle = Math.min(...projectionSet.frames.map((f) => f.angleDeg));
  const maxAngle = Math.max(...projectionSet.frames.map((f) => f.angleDeg));

  const detectorSummaries = Array.from({ length: projectionSet.numDetectors }, (_, d) => {
    const frames = projectionSet.frames.filter((f) => f.detector === d);
    const angles = frames.map((f) => f.angleDeg);
    const uniqueAngles = new Set(angles.map((a) => Math.round(a)));
    return {
      d,
      count: frames.length,
      unique: uniqueAngles.size,
      min: angles.length ? Math.min(...angles) : 0,
      max: angles.length ? Math.max(...angles) : 0,
    };
  });

  return (
    <div className="recon-controls">
      <h2>Akquisition</h2>
      <dl className="summary-list">
        <dt>Datei(en)</dt>
        <dd>{projectionSet.meta.sourceFileName}</dd>
        <dt>Detektorköpfe</dt>
        <dd>{projectionSet.numDetectors}</dd>
        <dt>Projektionen</dt>
        <dd>{numFrames}</dd>
        <dt>Winkelbereich</dt>
        <dd>
          {minAngle.toFixed(1)}° – {maxAngle.toFixed(1)}°
        </dd>
        <dt>Winkel je Kopf</dt>
        <dd>
          {detectorSummaries.map((s) => (
            <div key={s.d}>
              Kopf {s.d + 1}: {s.min.toFixed(0)}°–{s.max.toFixed(0)}°
              {s.unique !== s.count && <span style={{ color: "orange" }}> ({s.unique} eindeutig / {s.count} frames)</span>}
            </div>
          ))}
        </dd>
        <dt>Bildgröße</dt>
        <dd>
          {projectionSet.cols} x {projectionSet.cols} x {projectionSet.rows} (x · y · z)
        </dd>
        <dt>Pixelabstand</dt>
        <dd>
          {projectionSet.pixelSpacingMm[1].toFixed(2)} x {projectionSet.pixelSpacingMm[1].toFixed(2)} x{" "}
          {projectionSet.pixelSpacingMm[0].toFixed(2)} mm
        </dd>
        {projectionSet.meta.manufacturer && (
          <>
            <dt>Hersteller</dt>
            <dd>{projectionSet.meta.manufacturer}</dd>
          </>
        )}
        {projectionSet.meta.radionuclide && (
          <>
            <dt>Radionuklid</dt>
            <dd>{projectionSet.meta.radionuclide}</dd>
          </>
        )}
      </dl>

      <h2>Rekonstruktion</h2>
      <label className="field">
        Algorithmus
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as "fbp" | "osem")} disabled={busy}>
          <option value="fbp">Gefilterte Rückprojektion (FBP)</option>
          <option value="osem">Iterativ (OSEM)</option>
        </select>
      </label>

      {algorithm === "fbp" && (
        <label className="field">
          Filter
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as RampFilterType)} disabled={busy}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {algorithm === "osem" && (
        <>
          <label className="field">
            Subsets
            <input
              type="number"
              min={1}
              max={32}
              value={numSubsets}
              onChange={(e) => setNumSubsets(Number(e.target.value))}
              disabled={busy}
            />
          </label>
          <label className="field">
            Iterationen
            <input
              type="number"
              min={1}
              max={20}
              value={numIterations}
              onChange={(e) => setNumIterations(Number(e.target.value))}
              disabled={busy}
            />
          </label>
        </>
      )}

      {!busy ? (
        <button
          className="primary-btn"
          onClick={() =>
            onStart(
              algorithm === "fbp"
                ? { algorithm: "fbp", filterType }
                : { algorithm: "osem", numSubsets, numIterations },
            )
          }
        >
          Rekonstruieren
        </button>
      ) : (
        <>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <div className="progress-label">{Math.round((progress ?? 0) * 100)}%</div>
          <button className="secondary-btn" onClick={onCancel}>
            Abbrechen
          </button>
        </>
      )}
    </div>
  );
}
