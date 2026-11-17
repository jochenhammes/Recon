import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Vec3 } from "../core/geometry";
import { formatValue } from "../components/format";
import { compositeLayers } from "./composite";
import { ImageCanvas } from "./ImageCanvas";
import { orientedMip } from "./mip";
import { Volume3D } from "./volume";
import {
  type DisplayGrid,
  type PlaneKind,
  computeDisplayGrid,
  orientationLabels,
  planeBasis,
  planeNormalAxis,
  planeToWorld,
  samplePlane,
  valueAt,
  worldToPlane,
} from "./planes";
import { IDENTITY_TRANSFORM, type LayoutKind, type ViewKind, type ViewTransform, type ViewerLayer } from "./types";

export interface ViewerProps {
  /** Bottom layer first. */
  layers: ViewerLayer[];
  /** Layer that window/level drags apply to. */
  activeLayerId: string;
  /** Layer shown in the MIP view (default: the active layer). */
  mipLayerId?: string;
  cursor: Vec3 | null;
  onCursorChange: (p: Vec3) => void;
  onWindowChange: (layerId: string, window: [number, number]) => void;
  layout: LayoutKind;
  focusView: ViewKind;
  onLayoutChange: (layout: LayoutKind, focusView: ViewKind) => void;
  /** When set, left-dragging in a plane paints (calls onPaint) instead of moving the cursor. */
  paintMode?: boolean;
  onPaint?: (world: Vec3, normalAxis: 0 | 1 | 2) => void;
  /** Extra controls for the viewer toolbar. */
  toolbar?: ReactNode;
  /** Optional per-view overlay (e.g. VOI outlines), drawn in plane pixel coordinates. */
  planeOverlay?: (kind: PlaneKind, ctx: CanvasRenderingContext2D, toScreen: (u: number, v: number) => [number, number], basis: ReturnType<typeof planeBasis>, scale: number) => void;
}

const VIEW_TITLES: Record<ViewKind, string> = { axial: "Axial", coronal: "Koronar", sagittal: "Sagittal", mip: "MIP" };
const GRID_ORDER: ViewKind[] = ["axial", "sagittal", "coronal", "mip"];

export function Viewer(props: ViewerProps) {
  const { layers, activeLayerId, layout, focusView, onLayoutChange } = props;
  const visible = useShallowStable(layers.filter((l) => l.display.visible));
  const volumes = useShallowStable(layers.map((l) => l.volume));
  const grid = useMemo(() => computeDisplayGrid(volumes), [volumes]);
  const center: Vec3 = [(grid.min[0] + grid.max[0]) / 2, (grid.min[1] + grid.max[1]) / 2, (grid.min[2] + grid.max[2]) / 2];
  const cursor = props.cursor ?? center;
  const [transforms, setTransforms] = useState<Record<ViewKind, ViewTransform>>({
    axial: IDENTITY_TRANSFORM,
    coronal: IDENTITY_TRANSFORM,
    sagittal: IDENTITY_TRANSFORM,
    mip: IDENTITY_TRANSFORM,
  });
  const [hover, setHover] = useState<Vec3 | null>(null);
  const active = layers.find((l) => l.id === activeLayerId) ?? layers[layers.length - 1];
  const mipLayer = visible.find((l) => l.id === (props.mipLayerId ?? activeLayerId)) ?? visible[visible.length - 1];

  function dragWindow(dx: number, dy: number, target: ViewerLayer | undefined = active) {
    if (!target) return;
    const [lo, hi] = target.display.window;
    // ~200 px of drag spans the current window width, as before.
    const step = Math.max(hi - lo, 1e-6) / 200;
    const width = Math.max(hi - lo + dx * step, 1e-6);
    const level = (lo + hi) / 2 - dy * step;
    props.onWindowChange(target.id, [level - width / 2, level + width / 2]);
  }

  function setTransform(kind: ViewKind, t: ViewTransform) {
    setTransforms((prev) => ({ ...prev, [kind]: t }));
  }

  function toggleMaximize(kind: ViewKind) {
    if (layout === "single" && focusView === kind) onLayoutChange("grid", kind);
    else onLayoutChange("single", kind);
  }

  const renderView = (kind: ViewKind) =>
    kind === "mip" ? (
      <MipView
        key="mip"
        layer={mipLayer}
        transform={transforms.mip}
        onTransformChange={(t) => setTransform("mip", t)}
        onWindowDrag={(dx, dy) => dragWindow(dx, dy, mipLayer)}
        onDoubleClick={() => toggleMaximize("mip")}
      />
    ) : (
      <PlaneView
        key={kind}
        kind={kind}
        grid={grid}
        layers={visible}
        cursor={cursor}
        transform={transforms[kind]}
        onTransformChange={(t) => setTransform(kind, t)}
        onCursorChange={props.onCursorChange}
        onPaint={props.paintMode ? props.onPaint : undefined}
        onWindowDrag={dragWindow}
        onHover={setHover}
        onDoubleClick={() => toggleMaximize(kind)}
        overlay={props.planeOverlay}
      />
    );

  const others = GRID_ORDER.filter((k) => k !== focusView);
  const statusPoint = hover ?? cursor;

  return (
    <div className="viewer-root">
      <div className="viewer-toolbar">
        <div className="segmented" role="group" aria-label="Layout">
          {(
            [
              ["grid", "2×2"],
              ["focus", "1+3"],
              ["single", "1"],
            ] as [LayoutKind, string][]
          ).map(([k, label]) => (
            <button key={k} className={layout === k ? "active" : ""} onClick={() => onLayoutChange(k, focusView)}>
              {label}
            </button>
          ))}
        </div>
        {layout !== "grid" && (
          <select value={focusView} onChange={(e) => onLayoutChange(layout, e.target.value as ViewKind)} aria-label="Hauptansicht">
            {GRID_ORDER.map((k) => (
              <option key={k} value={k}>
                {VIEW_TITLES[k]}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setTransforms({ axial: IDENTITY_TRANSFORM, coronal: IDENTITY_TRANSFORM, sagittal: IDENTITY_TRANSFORM, mip: IDENTITY_TRANSFORM })}>
          Zoom zurücksetzen
        </button>
        {props.toolbar}
        <span className="viewer-hint">
          Klick: Fadenkreuz · Mausrad: Schicht · Strg+Mausrad: Zoom · Rechts ziehen: Fenster · Shift/Mitte ziehen: verschieben · Doppelklick: maximieren
        </span>
      </div>
      <div className={`viewer-layout layout-${layout}`}>
        {layout === "grid" && GRID_ORDER.map(renderView)}
        {layout === "single" && renderView(focusView)}
        {layout === "focus" && (
          <>
            <div className="focus-main">{renderView(focusView)}</div>
            <div className="focus-side">{others.map(renderView)}</div>
          </>
        )}
      </div>
      <div className="viewer-status">
        <span>
          {hover ? "Maus" : "Cursor"}: {statusPoint.map((v) => v.toFixed(1)).join(" / ")} mm (LPS)
        </span>
        {layers.filter((l) => !l.hideInStatus).map((l) => {
          const raw = valueAt(l.volume, l.w2v, statusPoint);
          const unit = l.unit;
          return (
            <span key={l.id}>
              {l.label}:{" "}
              {Number.isFinite(raw)
                ? unit && unit.scale !== 1
                  ? `${formatValue(raw * unit.scale)} ${unit.label}`
                  : `${formatValue(raw)}${unit?.label ? ` ${unit.label}` : ""}`
                : "–"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface PlaneViewProps {
  kind: PlaneKind;
  grid: DisplayGrid;
  layers: ViewerLayer[];
  cursor: Vec3;
  transform: ViewTransform;
  onTransformChange: (t: ViewTransform) => void;
  onCursorChange: (p: Vec3) => void;
  onPaint?: (world: Vec3, normalAxis: 0 | 1 | 2) => void;
  onWindowDrag: (dx: number, dy: number) => void;
  onHover: (p: Vec3 | null) => void;
  onDoubleClick: () => void;
  overlay?: ViewerProps["planeOverlay"];
}

/** Returns the previous array instance while its elements are unchanged (stable memo dependency). */
function useShallowStable<T>(arr: T[]): T[] {
  const ref = useRef(arr);
  const prev = ref.current;
  if (arr.length !== prev.length || arr.some((x, i) => x !== prev[i])) ref.current = arr;
  return ref.current;
}

function PlaneView(props: PlaneViewProps) {
  const { kind, grid, layers, cursor, overlay } = props;
  const axis = planeNormalAxis(kind);
  const planeCoord = cursor[axis];
  // Re-sample only when the plane or the volumes change — not on in-plane cursor moves or W/L changes.
  const basis = useMemo(() => planeBasis(grid, kind, planeCoord), [grid, kind, planeCoord]);
  const volumes = useShallowStable(layers.map((l) => l.volume));
  const transforms = useShallowStable(layers.map((l) => l.w2v));
  const displays = useShallowStable(layers.map((l) => l.display));
  const samples = useMemo(() => volumes.map((v, i) => samplePlane(v, transforms[i], basis)), [volumes, transforms, basis]);
  const image = useMemo(() => {
    const rgba = compositeLayers(
      displays.map((d, i) => ({ values: samples[i], window: d.window, lut: d.lut, opacity: d.opacity })),
      basis.width * basis.height,
    );
    return { rgba, width: basis.width, height: basis.height };
  }, [samples, displays, basis]);

  const [cu, cv] = worldToPlane(basis, cursor);
  const overlayFn = useMemo(
    () => (ctx: CanvasRenderingContext2D, toScreen: (u: number, v: number) => [number, number], scale: number) => {
      const [px, py] = toScreen(cu, cv);
      ctx.strokeStyle = "rgba(0, 220, 120, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, 0);
      ctx.lineTo(Math.round(px) + 0.5, 100000);
      ctx.moveTo(0, Math.round(py) + 0.5);
      ctx.lineTo(100000, Math.round(py) + 0.5);
      ctx.stroke();
      overlay?.(kind, ctx, toScreen, basis, scale);
    },
    [cu, cv, basis, kind, overlay],
  );

  // Slice step: finest voxel size of the shown layers along the plane normal.
  const step = useMemo(() => {
    let s = Infinity;
    for (const l of layers) {
      const g = l.volume.geometry;
      for (let a = 0; a < 3; a++) if (Math.abs(g.axes[a][axis]) > 0.7) s = Math.min(s, g.spacing[a]);
    }
    return Number.isFinite(s) ? s : grid.pixel;
  }, [layers, axis, grid.pixel]);

  const labels = useMemo(() => orientationLabels(kind), [kind]);
  const pos = ((planeCoord - grid.min[axis]) / Math.max(grid.max[axis] - grid.min[axis], 1e-6)) * 100;

  const { onHover } = props;
  useEffect(() => () => onHover(null), [onHover]);

  return (
    <ImageCanvas
      image={image}
      transform={props.transform}
      onTransformChange={props.onTransformChange}
      title={`${VIEW_TITLES[kind]} · ${planeCoord.toFixed(1)} mm`}
      actions={<span className="view-pos">{Math.round(pos)} %</span>}
      labels={labels}
      overlay={overlayFn}
      onPoint={(u, v) => {
        const w = planeToWorld(basis, u, v);
        w[axis] = planeCoord;
        if (props.onPaint) props.onPaint(w, axis);
        else props.onCursorChange(w);
      }}
      onHover={(u, v) => {
        const w = planeToWorld(basis, u, v);
        w[axis] = planeCoord;
        props.onHover(u >= -0.5 && v >= -0.5 && u < basis.width && v < basis.height ? w : null);
      }}
      onLeave={() => props.onHover(null)}
      onScroll={(dir) => {
        // Scrolling "down" moves towards foot/posterior/right as in common viewers.
        const sign = kind === "axial" ? -1 : kind === "coronal" ? 1 : -1;
        const next: Vec3 = [...cursor];
        next[axis] = Math.min(grid.max[axis], Math.max(grid.min[axis], cursor[axis] + sign * dir * step));
        props.onCursorChange(next);
      }}
      onWindowDrag={props.onWindowDrag}
      onDoubleClick={props.onDoubleClick}
    />
  );
}

interface MipViewProps {
  layer: ViewerLayer | undefined;
  transform: ViewTransform;
  onTransformChange: (t: ViewTransform) => void;
  onWindowDrag: (dx: number, dy: number) => void;
  onDoubleClick: () => void;
}

function MipView({ layer, transform, onTransformChange, onWindowDrag, onDoubleClick }: MipViewProps) {
  const [azimuth, setAzimuth] = useState(0);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    if (!rotating) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setAzimuth((a) => (a + (now - last) * 0.04) % 360);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rotating]);

  const deg = Math.round(azimuth / 3) * 3;
  const volume = layer?.volume;
  const display = layer?.display;
  const mip = useMemo(() => (volume instanceof Volume3D ? orientedMip(volume, deg) : null), [volume, deg]);
  const image = useMemo(() => {
    if (!mip || !display) return { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };
    const rgba = compositeLayers([{ values: mip.data, window: display.window, lut: display.lut, opacity: 1 }], mip.width * mip.height);
    return { rgba, width: mip.width, height: mip.height, pixelAspect: mip.pixelAspect };
  }, [mip, display]);

  return (
    <ImageCanvas
      image={image}
      transform={transform}
      onTransformChange={onTransformChange}
      title={`MIP · ${deg}°`}
      actions={
        <>
          <input
            className="mip-slider"
            type="range"
            min={0}
            max={359}
            value={Math.round(azimuth)}
            aria-label="MIP-Winkel"
            onChange={(e) => {
              setRotating(false);
              setAzimuth(Number(e.target.value));
            }}
          />
          <button className="mini-btn" onClick={() => setRotating((r) => !r)}>
            {rotating ? "Stop" : "Rotieren"}
          </button>
        </>
      }
      labels={deg === 0 ? ["H", "F", "R", "L"] : undefined}
      onScroll={(dir) => {
        setRotating(false);
        setAzimuth((a) => (a + dir * 6 + 360) % 360);
      }}
      onWindowDrag={onWindowDrag}
      onDoubleClick={onDoubleClick}
    />
  );
}
