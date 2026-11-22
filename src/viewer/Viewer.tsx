import { Layers } from "lucide-react";
import { useShallowStable } from "./useShallowStable";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type Vec3, applyWorldToVoxel, invert3, worldToVoxelTransform } from "../core/geometry";
import { formatValue } from "../components/format";
import { compositeLayers } from "./composite";
import { type GpuDraw, ImageCanvas } from "./ImageCanvas";
import { GlRenderer } from "./gl/renderer";
import { mipPick, mipSource, orientedMip } from "./mip";
import { type ColorLut, LUT_CHOICES, Volume3D, lutGradient, lutTable } from "./volume";
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

import { tr } from "../i18n";
export interface ViewerProps {
  /** Bottom layer first. */
  layers: ViewerLayer[];
  /** Layer that window/level drags apply to. */
  activeLayerId: string;
  /** Layer shown in the MIP view (default: the active layer). */
  mipLayerId?: string;
  /** MIP layer given directly (may be hidden in the slices; own color table). */
  mipLayer?: ViewerLayer;
  /** MIP with its own window (independent of the dataset): right-drag in the MIP changes it here. */
  onMipWindowChange?: (window: [number, number]) => void;
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
  /** Extra controls at the right end of the toolbar (before Skala/Ebenen). */
  toolbarRight?: ReactNode;
  /** Color table chosen in the color scale (right click). */
  onLutChange?: (layerId: string, lut: ColorLut) => void;
  /** Layer list shown as a floating panel (top right) when the "Ebenen" button is on. */
  layerPanel?: ReactNode;
  /** Optional per-view overlay (e.g. VOI outlines), drawn in plane pixel coordinates. */
  planeOverlay?: (kind: PlaneKind, ctx: CanvasRenderingContext2D, toScreen: (u: number, v: number) => [number, number], basis: ReturnType<typeof planeBasis>, scale: number) => void;
}

const EMPTY_RGBA = new Uint8ClampedArray(0);
const LAYERS_KEY = "recon-studio-layer-panel";
const LEGEND_KEY = "recon-studio-legend";

interface LegendItem {
  id: string;
  label: string;
  /** Color scale: gradient with min/max; label images: color and name of the region under the cursor. */
  lut: ViewerLayer["display"]["lut"];
  min?: string;
  max?: string;
  unit?: string;
  /** Window in raw units and display scale (for dragging the limits). */
  window?: [number, number];
  scale?: number;
  /** Fixed value range of the bar (raw units): data minimum … maximum, widened to include the window. */
  range?: [number, number];
  rangeMin?: string;
  rangeMax?: string;
  region?: { name: string; color: string };
}

/** Data minimum and maximum per voxel array (cached; the bar of the color scale spans this range). */
const dataRanges = new WeakMap<object, [number, number]>();
function dataRange(data: ArrayLike<number>): [number, number] {
  let r = dataRanges.get(data as object);
  if (!r) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    r = Number.isFinite(lo) ? [lo, hi > lo ? hi : lo + 1] : [0, 1];
    dataRanges.set(data as object, r);
  }
  return r;
}

/** Position (0..1) of the window limits on the bar. */
function windowOnBar(it: LegendItem): [number, number] {
  const [r0, r1] = it.range!;
  const [w0, w1] = it.window!;
  const f = (v: number) => Math.min(1, Math.max(0, (v - r0) / (r1 - r0 || 1)));
  return [f(w0), f(w1)];
}

/** CSS gradient of the bar: first LUT color below the window, the LUT across the window, last color above. */
function windowGradient(lut: ColorLut, a: number, b: number): string {
  const t = lutTable(lut);
  const c = (k: number) => `rgb(${t[k * 3]}, ${t[k * 3 + 1]}, ${t[k * 3 + 2]})`;
  const stops = [`${c(0)} 0%`, `${c(0)} ${a * 100}%`];
  for (let i = 0; i <= 12; i++) stops.push(`${c(Math.round((i / 12) * 255))} ${(a + ((b - a) * i) / 12) * 100}%`);
  stops.push(`${c(255)} ${b * 100}%`, `${c(255)} 100%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** Legend entries: every visible colored layer (window in display units) and label images (region under the cursor). */
function legendItems(layers: ViewerLayer[], point: Vec3): LegendItem[] {
  const out: LegendItem[] = [];
  for (const l of layers) {
    if (!l.display.visible || l.hideInStatus) continue;
    if (l.display.lut === "labels") {
      const v = Math.round(valueAt(l.volume, l.w2v, point));
      const t = lutTable("labels");
      // Same mapping as the renderer: label images use the window [0, 255].
      const w = l.display.window;
      const idx = Math.max(0, Math.min(255, Math.round(((v - w[0]) / (w[1] - w[0] || 1)) * 255)));
      const region = Number.isFinite(v) && v > 0 ? { name: l.labelNames?.get(v) ?? tr("Label {v}", { v }), color: `rgb(${t[idx * 3]}, ${t[idx * 3 + 1]}, ${t[idx * 3 + 2]})` } : undefined;
      out.push({ id: l.id, label: l.label, lut: "labels", region });
      continue;
    }
    if (l.display.lut === "voi") continue;
    const sc = l.unit?.scale ?? 1;
    const [d0, d1] = dataRange(l.volume.data);
    const range: [number, number] = [Math.min(d0, l.display.window[0]), Math.max(d1, l.display.window[1])];
    out.push({
      id: l.id,
      label: l.label,
      lut: l.display.lut,
      min: formatValue(l.display.window[0] * sc),
      max: formatValue(l.display.window[1] * sc),
      unit: l.unit?.label,
      window: l.display.window,
      scale: sc,
      range,
      rangeMin: formatValue(range[0] * sc),
      rangeMax: formatValue(range[1] * sc),
    });
  }
  return out;
}

/** Draws the legend into a screenshot (bottom left, scaled by dpr). */
function drawLegend(ctx: CanvasRenderingContext2D, items: LegendItem[], height: number, dpr: number) {
  if (!items.length) return;
  const pad = 8 * dpr, row = 30 * dpr, w = 190 * dpr;
  const h = pad * 2 + row * items.length;
  let y = height - h - 8 * dpr;
  const x = 8 * dpr;
  ctx.save();
  ctx.fillStyle = "rgba(16, 17, 22, 0.85)";
  ctx.fillRect(x, y, w, h);
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  y += pad;
  for (const it of items) {
    ctx.fillStyle = "#d8dbe4";
    ctx.fillText(it.region ? `${it.label}: ${it.region.name}` : it.label, x + pad, y);
    if (!it.region && it.lut !== "labels") {
      const t = lutTable(it.lut);
      const gx = x + pad, gy = y + 14 * dpr, gw = w - 2 * pad, gh = 6 * dpr;
      const [a, b] = windowOnBar(it);
      for (let i = 0; i < gw; i++) {
        const f = i / (gw - 1);
        const k = Math.round(Math.min(1, Math.max(0, (f - a) / (b - a || 1e-6))) * 255);
        ctx.fillStyle = `rgb(${t[k * 3]}, ${t[k * 3 + 1]}, ${t[k * 3 + 2]})`;
        ctx.fillRect(gx + i, gy, 1, gh);
      }
      ctx.fillStyle = "#ffffff";
      for (const f of [a, b]) ctx.fillRect(gx + f * (gw - 1) - dpr, gy - dpr, 2 * dpr, gh + 2 * dpr);
      ctx.fillStyle = "#a3a7b6";
      ctx.font = `${10 * dpr}px system-ui, sans-serif`;
      const mid = `${it.min} – ${it.max}${it.unit ? ` ${it.unit}` : ""}`;
      ctx.fillText(mid, gx + (gw - ctx.measureText(mid).width) / 2, gy + gh + 1 * dpr);
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    }
    y += row;
  }
  ctx.restore();
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
  const [layersOpen, setLayersOpen] = useState(() => {
    try {
      return localStorage.getItem(LAYERS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleLayers = () => {
    setLayersOpen((o) => {
      try {
        localStorage.setItem(LAYERS_KEY, o ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !o;
    });
  };
  const [helpOpen, setHelpOpen] = useState(false);
  const [legendOn, setLegendOn] = useState(() => {
    try {
      return localStorage.getItem(LEGEND_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleLegend = () =>
    setLegendOn((o) => {
      try {
        localStorage.setItem(LEGEND_KEY, o ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !o;
    });
  const active = layers.find((l) => l.id === activeLayerId) ?? layers[layers.length - 1];
  const mipLayer = props.mipLayer ?? visible.find((l) => l.id === (props.mipLayerId ?? activeLayerId)) ?? visible[visible.length - 1];
  const mipVolume = mipLayer?.volume;
  // Free GPU textures of volumes that are no longer shown (plus the MIP source of the MIP layer).
  useEffect(() => {
    const gl = GlRenderer.get();
    if (!gl) return;
    gl.retain([...volumes, ...(mipVolume instanceof Volume3D ? [mipSource(mipVolume)] : [])]);
  }, [volumes, mipVolume]);

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
        onWindowDrag={(dx, dy) => {
          if (!props.onMipWindowChange || !mipLayer) return dragWindow(dx, dy, mipLayer);
          const [lo, hi] = mipLayer.display.window;
          const step = Math.max(hi - lo, 1e-6) / 200;
          const width = Math.max(hi - lo + dx * step, 1e-6);
          const level = (lo + hi) / 2 - dy * step;
          props.onMipWindowChange([level - width / 2, level + width / 2]);
        }}
        onDoubleClick={() => toggleMaximize("mip")}
        onCursorChange={props.onCursorChange}
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
  const layoutRef = useRef<HTMLDivElement>(null);

  /** Saves the visible views (as rendered, incl. overlays) as one PNG. */
  function screenshot() {
    const root = layoutRef.current;
    if (!root) return;
    const dpr = window.devicePixelRatio || 1;
    const rootRect = root.getBoundingClientRect();
    const out = document.createElement("canvas");
    out.width = Math.round(rootRect.width * dpr);
    out.height = Math.round(rootRect.height * dpr);
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);
    root.querySelectorAll("canvas").forEach((c) => {
      const r = c.getBoundingClientRect();
      ctx.drawImage(c, Math.round((r.left - rootRect.left) * dpr), Math.round((r.top - rootRect.top) * dpr), Math.round(r.width * dpr), Math.round(r.height * dpr));
    });
    if (legendOn) drawLegend(ctx, legendItems(layers, cursor), out.height, dpr);
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recon-studio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }
  const statusPoint = hover ?? cursor;

  return (
    <div className="viewer-root">
      <div className="viewer-toolbar">
        <div className="segmented" role="group" aria-label={tr("Layout")}>
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
          <select value={focusView} onChange={(e) => onLayoutChange(layout, e.target.value as ViewKind)} aria-label={tr("Hauptansicht")}>
            {GRID_ORDER.map((k) => (
              <option key={k} value={k}>
                {VIEW_TITLES[k]}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setTransforms({ axial: IDENTITY_TRANSFORM, coronal: IDENTITY_TRANSFORM, sagittal: IDENTITY_TRANSFORM, mip: IDENTITY_TRANSFORM })}>
          {tr("Zoom zurücksetzen")}
        </button>
        <button onClick={screenshot} title={tr("Aktuelle Ansicht als PNG speichern")}>
          {tr("Screenshot")}
        </button>
        {props.toolbar}
        <span className="viewer-toolbar-right">
          {props.toolbarRight}
          <button className={legendOn ? "active" : ""} aria-pressed={legendOn} title={tr("Farbskala ein-/ausblenden (wird auch im Screenshot gezeigt)")} onClick={toggleLegend}>
            {tr("Skala")}
          </button>
          {props.layerPanel && (
            <button className={layersOpen ? "active" : ""} aria-pressed={layersOpen} title={tr("Ebenen ein-/ausblenden")} onClick={toggleLayers}>
              <Layers size={13} /> {tr("Ebenen")}
            </button>
          )}
          <button className={helpOpen ? "active" : ""} aria-pressed={helpOpen} aria-label={tr("Maus- und Tastenbedienung")} title={tr("Maus- und Tastenbedienung")} onClick={() => setHelpOpen((o) => !o)}>
            ?
          </button>
          {helpOpen && (
            <div className="viewer-help" role="dialog" aria-label={tr("Bedienung")}>
              <dl>
                <dt>{tr("Klick")}</dt>
                <dd>{tr("Fadenkreuz setzen")}</dd>
                <dt>{tr("Mausrad")}</dt>
                <dd>{tr("Schicht wechseln")}</dd>
                <dt>{tr("Strg + Mausrad")}</dt>
                <dd>{tr("Zoom")}</dd>
                <dt>{tr("Rechts ziehen")}</dt>
                <dd>{tr("Fenster (Helligkeit/Kontrast)")}</dd>
                <dt>{tr("Shift / Mitte ziehen")}</dt>
                <dd>{tr("Bild verschieben")}</dd>
                <dt>{tr("Doppelklick")}</dt>
                <dd>{tr("Ansicht maximieren")}</dd>
              </dl>
            </div>
          )}
        </span>
      </div>
      <div ref={layoutRef} className={`viewer-layout layout-${layout}`}>
        {props.layerPanel && layersOpen && <div className="viewer-layer-panel">{props.layerPanel}</div>}
        {legendOn && <Legend items={legendItems(layers, statusPoint)} onWindowChange={props.onWindowChange} onLutChange={props.onLutChange} />}
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
        {layers.filter((l) => !l.hideInStatus && l.display.visible).map((l) => {
          const raw = valueAt(l.volume, l.w2v, statusPoint);
          const unit = l.unit;
          const region = l.labelNames && Number.isFinite(raw) ? (Math.round(raw) === 0 ? "–" : (l.labelNames.get(Math.round(raw)) ?? String(Math.round(raw)))) : undefined;
          return (
            <span key={l.id} className="status-value" title={l.title}>
              <i className="lut-swatch" style={{ background: lutGradient(l.display.lut) }} aria-hidden="true" />
              {l.label}:{" "}
              {region !== undefined
                ? region
                : Number.isFinite(raw)
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


function PlaneView(props: PlaneViewProps) {
  const { kind, grid, layers, cursor, overlay } = props;
  const axis = planeNormalAxis(kind);
  const planeCoord = cursor[axis];
  // Re-sample only when the plane or the volumes change — not on in-plane cursor moves or W/L changes.
  const basis = useMemo(() => planeBasis(grid, kind, planeCoord), [grid, kind, planeCoord]);
  const volumes = useShallowStable(layers.map((l) => l.volume));
  const transforms = useShallowStable(layers.map((l) => l.w2v));
  const displays = useShallowStable(layers.map((l) => l.display));
  // GPU (WebGL2) when available and the volumes fit; otherwise the CPU path (sampling + compositing).
  const [gpuFailed, setGpuFailed] = useState(false);
  const gl = gpuFailed ? null : GlRenderer.get();
  const useGpu = !!gl && gl.canHost(volumes);
  const nearestKey = displays.map((d) => (d.nearest ? 1 : 0)).join("");
  const samples = useMemo(
    () => (useGpu ? [] : volumes.map((v, i) => samplePlane(v, transforms[i], basis, undefined, nearestKey[i] === "1"))),
    [useGpu, volumes, transforms, basis, nearestKey],
  );
  const image = useMemo(() => {
    if (useGpu) return { rgba: EMPTY_RGBA, width: basis.width, height: basis.height };
    const rgba = compositeLayers(
      displays.map((d, i) => ({ values: samples[i], window: d.window, lut: d.lut, opacity: d.opacity })),
      basis.width * basis.height,
    );
    return { rgba, width: basis.width, height: basis.height };
  }, [useGpu, samples, displays, basis]);
  const gpuDraw = useMemo<GpuDraw | undefined>(() => {
    if (!useGpu || !gl) return undefined;
    return (t) => {
      try {
        const du = 1 / (t.dpr * t.sx);
        const dv = 1 / (t.dpr * t.sy);
        const au = (0.5 / t.dpr - t.x0) / t.sx - 0.5;
        const av = (0.5 / t.dpr - t.y0) / t.sy - 0.5;
        const { origin: O, U, V } = basis;
        return gl.renderPlane(
          volumes.map((v, i) => ({ volume: v, w2v: transforms[i], display: displays[i] })),
          {
            width: t.width,
            height: t.height,
            world0: [O[0] + au * U[0] + av * V[0], O[1] + au * U[1] + av * V[1], O[2] + au * U[2] + av * V[2]],
            worldDx: [U[0] * du, U[1] * du, U[2] * du],
            worldDy: [V[0] * dv, V[1] * dv, V[2] * dv],
          },
        );
      } catch (e) {
        console.error("WebGL rendering failed, using the CPU path:", e);
        setGpuFailed(true);
        return null;
      }
    };
  }, [useGpu, gl, basis, volumes, transforms, displays]);

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
      gpuDraw={gpuDraw}
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
  /** Click: crosshair to the hottest voxel along the clicked ray (sets the axial slice of the click). */
  onCursorChange: (p: Vec3) => void;
  transform: ViewTransform;
  onTransformChange: (t: ViewTransform) => void;
  onWindowDrag: (dx: number, dy: number) => void;
  onDoubleClick: () => void;
}

function MipView({ layer, transform, onTransformChange, onWindowDrag, onDoubleClick, onCursorChange }: MipViewProps) {
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

  const volume = layer?.volume;
  const display = layer?.display;
  const [gpuFailed, setGpuFailed] = useState(false);
  const gl = gpuFailed ? null : GlRenderer.get();
  const src = useMemo(() => (volume instanceof Volume3D ? mipSource(volume) : null), [volume]);
  const useGpu = !!gl && !!src && gl.canHost([src]);
  // GPU: continuous angle; CPU: 3° steps (each angle is a full ray-marching pass).
  const deg = useGpu ? azimuth : Math.round(azimuth / 3) * 3;
  const mip = useMemo(() => (!useGpu && volume instanceof Volume3D ? orientedMip(volume, deg) : null), [useGpu, volume, deg]);
  const image = useMemo(() => {
    if (useGpu && src) {
      const [sx, , sz] = src.geometry.spacing;
      return { rgba: EMPTY_RGBA, width: Math.max(src.nx, src.ny), height: src.nz, pixelAspect: sz / sx };
    }
    if (!mip || !display) return { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };
    const rgba = compositeLayers([{ values: mip.data, window: display.window, lut: display.lut, opacity: 1 }], mip.width * mip.height);
    return { rgba, width: mip.width, height: mip.height, pixelAspect: mip.pixelAspect };
  }, [useGpu, src, mip, display]);
  const gpuDraw = useMemo<GpuDraw | undefined>(() => {
    if (!useGpu || !gl || !src || !display) return undefined;
    return (t) => {
      try {
        return gl.renderMip(
          { volume: src, w2v: { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: [0, 0, 0] }, display },
          {
            width: t.width,
            height: t.height,
            img0: [(0.5 / t.dpr - t.x0) / t.sx - 0.5, (0.5 / t.dpr - t.y0) / t.sy - 0.5],
            imgD: [1 / (t.dpr * t.sx), 1 / (t.dpr * t.sy)],
            imgSize: [Math.max(src.nx, src.ny), src.nz],
            thetaRad: (deg * Math.PI) / 180,
            flip: [src.geometry.axes[0][0] < 0, src.geometry.axes[2][2] > 0],
          },
        );
      } catch (e) {
        console.error("WebGL MIP failed, using the CPU path:", e);
        setGpuFailed(true);
        return null;
      }
    };
  }, [useGpu, gl, src, display, deg]);

  return (
    <ImageCanvas
      image={image}
      transform={transform}
      onTransformChange={onTransformChange}
      gpuDraw={gpuDraw}
      title={`MIP · ${Math.round(deg)}°`}
      actions={
        <>
          <input
            className="mip-slider"
            type="range"
            min={0}
            max={359}
            value={Math.round(azimuth)}
            aria-label={tr("MIP-Winkel")}
            onChange={(e) => {
              setRotating(false);
              setAzimuth(Number(e.target.value));
            }}
          />
          <button className="mini-btn" onClick={() => setRotating((r) => !r)}>
            {rotating ? "Stop" : tr("Rotieren")}
          </button>
        </>
      }
      labels={Math.round(deg) === 0 ? ["H", "F", "R", "L"] : undefined}
      onScroll={(dir) => {
        setRotating(false);
        setAzimuth((a) => (a + dir * 6 + 360) % 360);
      }}
      onWindowDrag={onWindowDrag}
      onDoubleClick={onDoubleClick}
      onPoint={(u, v) => {
        if (!(volume instanceof Volume3D) || !layer) return;
        setRotating(false);
        const native = mipPick(volume, deg, u, v);
        if (!native) return;
        // Native patient coordinate → voxel of the layer volume → reference world (inverse of the layer placement).
        const vox = applyWorldToVoxel(worldToVoxelTransform(volume.geometry), native);
        const inv = invert3(layer.w2v.m);
        onCursorChange([
          inv[0] * vox[0] + inv[1] * vox[1] + inv[2] * vox[2] + layer.w2v.origin[0],
          inv[3] * vox[0] + inv[4] * vox[1] + inv[5] * vox[2] + layer.w2v.origin[1],
          inv[6] * vox[0] + inv[7] * vox[1] + inv[8] * vox[2] + layer.w2v.origin[2],
        ]);
      }}
    />
  );
}

/**
 * Color scale: drag the left/right end of a bar to change the window minimum/maximum, drag the middle to shift the
 * window; right click on a bar chooses the color table.
 */
function Legend({
  items,
  onWindowChange,
  onLutChange,
}: {
  items: LegendItem[];
  onWindowChange: (layerId: string, window: [number, number]) => void;
  onLutChange?: (layerId: string, lut: ColorLut) => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; lut: ColorLut } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: "min" | "max" | "shift"; x0: number; w0: [number, number]; px: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.(".lut-menu")) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);
  if (!items.length) return null;

  const startDrag = (e: React.PointerEvent<HTMLElement>, it: LegendItem, mode: "min" | "max" | "shift") => {
    if (e.button !== 0 || !it.window) return;
    e.preventDefault();
    e.stopPropagation();
    const bar = (e.currentTarget.closest(".legend-bar-wrap") as HTMLElement).getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The bar spans the fixed value range: one pixel = range / bar width.
    const [r0, r1] = it.range ?? it.window;
    drag.current = { id: it.id, mode, x0: e.clientX, w0: it.window, px: Math.max(20, bar.width) / (r1 - r0 || 1) };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [lo, hi] = d.w0;
    const delta = (e.clientX - d.x0) / d.px;
    const minWidth = Math.abs(hi - lo) * 0.01 || 1e-6;
    let next: [number, number];
    if (d.mode === "min") next = [Math.min(lo + delta, hi - minWidth), hi];
    else if (d.mode === "max") next = [lo, Math.max(hi + delta, lo + minWidth)];
    else next = [lo + delta, hi + delta];
    onWindowChange(d.id, next);
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="viewer-legend" aria-label={tr("Farbskala")} ref={rootRef} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {items.map((it) =>
        it.lut === "labels" ? (
          <div key={it.id} className="legend-row">
            <span className="legend-name">{it.label}</span>
            <span className="legend-region">
              {it.region ? (
                <>
                  <i style={{ background: it.region.color }} />
                  {it.region.name}
                </>
              ) : (
                "–"
              )}
            </span>
          </div>
        ) : (
          <div key={it.id} className="legend-row">
            <span className="legend-name">{it.label}</span>
            <LegendBar item={it} onContextMenu={(e) => {
                if (!onLutChange) return;
                e.preventDefault();
                const r = rootRef.current!.getBoundingClientRect();
                setMenu({ id: it.id, x: e.clientX - r.left, y: e.clientY - r.top, lut: it.lut });
              }} startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
            <span className="legend-scale">
              <span>{it.rangeMin}</span>
              <span className="legend-window">
                {it.min} – {it.max}
                {it.unit ? ` ${it.unit}` : ""}
              </span>
              <span>{it.rangeMax}</span>
            </span>
          </div>
        ),
      )}
      {menu && onLutChange && (
        <div className="lut-menu" role="menu" style={{ left: Math.min(menu.x, 40), bottom: `calc(100% - ${menu.y}px)` }}>
          {LUT_CHOICES.filter((c) => c.value !== "labels").map((c) => (
            <button
              key={c.value}
              role="menuitemradio"
              aria-checked={c.value === menu.lut}
              className={c.value === menu.lut ? "active" : ""}
              onClick={() => {
                onLutChange(menu.id, c.value);
                setMenu(null);
              }}
            >
              <i style={{ background: lutGradient(c.value) }} />
              {tr(c.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LegendBar({
  item,
  onContextMenu,
  startDrag,
  moveDrag,
  endDrag,
}: {
  item: LegendItem;
  onContextMenu: (e: React.MouseEvent) => void;
  startDrag: (e: React.PointerEvent<HTMLElement>, it: LegendItem, mode: "min" | "max" | "shift") => void;
  moveDrag: (e: React.PointerEvent) => void;
  endDrag: () => void;
}) {
  const [a, b] = item.range && item.window ? windowOnBar(item) : [0, 1];
  const drag = (mode: "min" | "max" | "shift") => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, item, mode),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });
  return (
    <div className="legend-bar-wrap" title={tr("Griffe ziehen: Fenster-Min/-Max · Bereich dazwischen ziehen: verschieben · Rechtsklick: Farbtabelle")} onContextMenu={onContextMenu}>
      <span className="legend-bar" style={{ background: windowGradient(item.lut, a, b) }} />
      <span className="legend-window-span" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} {...drag("shift")} />
      <span className="legend-handle" style={{ left: `${a * 100}%` }} aria-label={tr("Fenster-Minimum ziehen")} {...drag("min")} />
      <span className="legend-handle" style={{ left: `${b * 100}%` }} aria-label={tr("Fenster-Maximum ziehen")} {...drag("max")} />
    </div>
  );
}
