import type { LucideIcon } from "lucide-react";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import type { ReactNode } from "react";

export interface ShellTab {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
  disabled?: boolean;
  /** Small badge on the nav item (e.g. number of edits). */
  badge?: string | number;
}

export interface AppShellProps {
  tabs: ShellTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  /** Chips / info in the header (loaded datasets). */
  headerInfo?: ReactNode;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  const { tabs, activeTab, onTabChange, panelOpen, onPanelOpenChange, theme } = props;
  const current = tabs.find((t) => t.id === activeTab) ?? tabs[0];

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
                <span>{t.label}</span>
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
        {panelOpen && (
          <aside className="side-panel" aria-label={current.label}>
            <div className="side-panel-head">
              <h2>{current.label}</h2>
            </div>
            <div className="side-panel-body">{current.content}</div>
          </aside>
        )}
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
