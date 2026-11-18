import type { LucideIcon } from "lucide-react";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface ShellTab {
  id: string;
  label: string;
  /** Shorter label for the navigation rail (defaults to `label`). */
  shortLabel?: string;
  icon: LucideIcon;
  content: ReactNode;
  disabled?: boolean;
  /** Small badge on the nav item (e.g. number of edits). */
  badge?: string | number;
  /** Use a wider side panel (e.g. header table). */
  wide?: boolean;
}

export interface AppShellProps {
  tabs: ShellTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  /** Content in the middle of the header (activity indicator). */
  headerInfo?: ReactNode;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  const { tabs, activeTab, onTabChange, panelOpen, onPanelOpenChange, theme } = props;
  const current = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const [panelWidth, setPanelWidth] = usePanelWidth();
  // Tabs stay mounted once visited (hidden when inactive), so running jobs, results and open cards survive a tab switch.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([current.id]));
  if (!visited.has(current.id)) setVisited(new Set(visited).add(current.id));
  const width = current.wide ? Math.max(panelWidth, WIDE_WIDTH) : panelWidth;

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="brand">
          <BrandMark />
          <h1>Recon Studio</h1>
        </div>
        <div className="header-info">{props.headerInfo}</div>
        <button
          className="icon-btn"
          title={theme === "dark" ? "Helles Design" : "Dunkles Design"}
          aria-label="Design umschalten"
          onClick={() => props.onThemeChange(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>
      <div className="shell-body">
        <nav className="nav-rail" aria-label="Werkzeuge">
          {tabs.map((t) => {
            const Icon = t.icon;
            const selected = t.id === current.id && panelOpen;
            return (
              <button
                key={t.id}
                className={selected ? "nav-item selected" : "nav-item"}
                disabled={t.disabled}
                aria-pressed={selected}
                title={t.label}
                onClick={() => {
                  if (t.id === current.id) onPanelOpenChange(!panelOpen);
                  else {
                    onTabChange(t.id);
                    onPanelOpenChange(true);
                  }
                }}
              >
                <Icon size={20} strokeWidth={1.7} />
                <span>{t.shortLabel ?? t.label}</span>
                {t.badge !== undefined && t.badge !== 0 && <em className="nav-badge">{t.badge}</em>}
              </button>
            );
          })}
          <div className="nav-spacer" />
          <button
            className="nav-item nav-toggle"
            title={panelOpen ? "Panel einklappen" : "Panel ausklappen"}
            aria-label={panelOpen ? "Panel einklappen" : "Panel ausklappen"}
            onClick={() => onPanelOpenChange(!panelOpen)}
          >
            {panelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </nav>
        <aside className="side-panel" style={{ width }} aria-label={current.label} hidden={!panelOpen}>
          <div className="side-panel-head">
            <h2>{current.label}</h2>
          </div>
          {tabs
            .filter((t) => visited.has(t.id))
            .map((t) => (
              <div key={t.id} className="side-panel-body" hidden={t.id !== current.id}>
                {t.content}
              </div>
            ))}
          <ResizeHandle width={width} onChange={setPanelWidth} />
        </aside>
        <main className="workspace">{props.children}</main>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--accent)" strokeWidth="2.5" opacity="0.45" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="var(--accent)" strokeWidth="2.5" opacity="0.75" />
      <circle cx="16" cy="16" r="3.5" fill="var(--accent-strong)" />
    </svg>
  );
}

const DEFAULT_WIDTH = 340;
const WIDE_WIDTH = 480;
const MIN_WIDTH = 280;
const WIDTH_KEY = "recon-studio-panel-width";
const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6));
const clampWidth = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, w)));

/** Side panel width, remembered per browser. */
function usePanelWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return v ? clampWidth(v) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* storage unavailable */
    }
  }, [width]);
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return [width, (w) => setWidth(clampWidth(w))];
}

/** Drag handle on the right edge of the side panel (double click: default width, arrow keys: ±20 px). */
function ResizeHandle({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="panel-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panelbreite"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      tabIndex={0}
      title="Ziehen: Panelbreite ändern · Doppelklick: Standardbreite"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        document.body.classList.add("resizing-panel");
      }}
      onPointerMove={(e) => {
        if (drag.current) onChange(drag.current.w + e.clientX - drag.current.x);
      }}
      onPointerUp={() => {
        drag.current = null;
        document.body.classList.remove("resizing-panel");
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.classList.remove("resizing-panel");
      }}
      onDoubleClick={() => onChange(DEFAULT_WIDTH)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(width - 20);
        else if (e.key === "ArrowRight") onChange(width + 20);
        else return;
        e.preventDefault();
      }}
    />
  );
}
