import { useMemo, useState } from "react";
import { SliceCanvas } from "./SliceCanvas";
import { MipCanvas } from "./MipCanvas";
import type { Volume3D } from "./volume";

export interface FourPanelViewerProps {
  volume: Volume3D;
}

interface Cursor {
  x: number;
  y: number;
  z: number;
}

export function FourPanelViewer({ volume }: FourPanelViewerProps) {
  const [cursor, setCursor] = useState<Cursor>(() => ({
    x: Math.floor(volume.nx / 2),
    y: Math.floor(volume.ny / 2),
    z: Math.floor(volume.nz / 2),
  }));
  const defaultWindow = useMemo(() => {
    const max = volume.percentile(99);
    return { min: 0, max: Math.max(max, 1e-6) };
  }, [volume]);
  const [windowMin, setWindowMin] = useState(defaultWindow.min);
  const [windowMax, setWindowMax] = useState(defaultWindow.max);

  function clampCursor(next: Partial<Cursor>): Cursor {
    return {
      x: Math.max(0, Math.min(volume.nx - 1, next.x ?? cursor.x)),
      y: Math.max(0, Math.min(volume.ny - 1, next.y ?? cursor.y)),
      z: Math.max(0, Math.min(volume.nz - 1, next.z ?? cursor.z)),
    };
  }

  function adjustWindowLevel(deltaWindow: number, deltaLevel: number) {
    const level = (windowMin + windowMax) / 2 + deltaLevel;
    const window = Math.max((windowMax - windowMin) + deltaWindow, 1e-6);
    setWindowMin(level - window / 2);
    setWindowMax(level + window / 2);
  }

  function resetWindowLevel() {
    setWindowMin(defaultWindow.min);
    setWindowMax(defaultWindow.max);
  }

  const axial = volume.axialSlice(cursor.z);
  const sagittal = volume.sagittalSlice(cursor.x);
  const coronal = volume.coronalSlice(cursor.y);
  const [spacingZ, spacingY, spacingX] = volume.voxelSpacingMm;

  return (
    <div className="viewer-root">
      <div className="viewer-toolbar">
        <span>
          Fenster: {(windowMax - windowMin).toFixed(1)} &nbsp; Level: {((windowMin + windowMax) / 2).toFixed(1)}
        </span>
        <button onClick={resetWindowLevel}>W/L zurücksetzen</button>
        <span className="viewer-hint">
          Linksklick/Ziehen: Fadenkreuz · Rechtsklick/Ziehen (oder Alt): Fenster/Level · Mausrad: Slice
        </span>
      </div>
      <div className="viewer-grid">
        <div className="slice-panel">
          <div className="slice-panel-label">Axial (z={cursor.z + 1}/{volume.nz})</div>
          <SliceCanvas
            data={axial.data}
            width={axial.width}
            height={axial.height}
            pixelAspectRatio={spacingY / spacingX}
            windowMin={windowMin}
            windowMax={windowMax}
            crosshairCol={cursor.x}
            crosshairRow={cursor.y}
            onCrosshairChange={(col, row) => setCursor(clampCursor({ x: col, y: row }))}
            onScrollSlice={(dir) => setCursor(clampCursor({ z: cursor.z + dir }))}
            onWindowLevelDrag={adjustWindowLevel}
          />
        </div>
        <div className="slice-panel">
          <div className="slice-panel-label">
            Sagittal (x={cursor.x + 1}/{volume.nx})
          </div>
          <SliceCanvas
            data={sagittal.data}
            width={sagittal.width}
            height={sagittal.height}
            pixelAspectRatio={spacingZ / spacingY}
            windowMin={windowMin}
            windowMax={windowMax}
            crosshairCol={cursor.y}
            crosshairRow={cursor.z}
            onCrosshairChange={(col, row) => setCursor(clampCursor({ y: col, z: row }))}
            onScrollSlice={(dir) => setCursor(clampCursor({ x: cursor.x + dir }))}
            onWindowLevelDrag={adjustWindowLevel}
          />
        </div>
        <div className="slice-panel">
          <div className="slice-panel-label">
            Coronal (y={cursor.y + 1}/{volume.ny})
          </div>
          <SliceCanvas
            data={coronal.data}
            width={coronal.width}
            height={coronal.height}
            pixelAspectRatio={spacingZ / spacingX}
            windowMin={windowMin}
            windowMax={windowMax}
            crosshairCol={cursor.x}
            crosshairRow={cursor.z}
            onCrosshairChange={(col, row) => setCursor(clampCursor({ x: col, z: row }))}
            onScrollSlice={(dir) => setCursor(clampCursor({ y: cursor.y + dir }))}
            onWindowLevelDrag={adjustWindowLevel}
          />
        </div>
        <MipCanvas volume={volume} windowMin={windowMin} windowMax={windowMax} onWindowLevelDrag={adjustWindowLevel} />
      </div>
    </div>
  );
}
