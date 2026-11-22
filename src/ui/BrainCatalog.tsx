import { useRef, useState } from "react";
import { BUNDLED, type BundledEntry, type CatalogGroup, GROUP_LABELS, LICENSE_LABELS, type LicenseClass, USER_ENTRIES, type UserEntry, bundledEntry } from "../brain/catalog";
import { InfoText } from "./Info";

import { t } from "../i18n";
const base = import.meta.env.BASE_URL;
const href = (u: string) => (/^https?:/.test(u) ? u : `${base}${u}`);
const fmtSize = (kb: number) => (kb >= 1000 ? `${(kb / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(kb))} kB`);
const res = (mm: number) => `${String(mm).replace(".", ",")} mm`;

function LicenseBadge({ c, name, url }: { c: LicenseClass; name: string; url?: string }) {
  const badge = <span className={`lic-badge lic-${c}`} title={name}>{t(LICENSE_LABELS[c])}</span>;
  return url ? (
    <a href={href(url)} target="_blank" rel="noreferrer" className="lic-link" title={t("{name} – Lizenz/Quelle", { name })}>
      {badge}
    </a>
  ) : (
    badge
  );
}

export interface BrainCatalogProps {
  /** Catalogue ids already present as datasets. */
  loaded: Set<string>;
  busyId: string | null;
  onLoad: (id: string) => void;
  /** Files selected for the user-download entries (image + table, or a ZIP). */
  onUserFiles: (files: File[]) => void;
  /** Catalogue ids with files stored in this browser. */
  cached: string[];
  onLoadCached: (id: string) => void;
  onRemoveCached: (id: string) => void;
  error?: string | null;
}

/** Card content "Vorlagen & Atlanten": bundled entries by group and the entries the user downloads from the source. */
export function BrainCatalog(p: BrainCatalogProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const groups: CatalogGroup[] = ["mri", "pet", "ct", "tpm", "atlas"];
  const row = (e: BundledEntry) => {
    const isLoaded = p.loaded.has(e.id);
    return (
      <li key={e.id} className="catalog-row">
        <div className="catalog-main">
          <span className="catalog-name" title={t(e.attribution)}>
            {t(e.name)}
          </span>
          <span className="catalog-meta">
            {t(e.modality)} · {e.space} · {fmtSize(e.sizeKb)} <LicenseBadge c={e.license.class} name={t(e.license.name)} url={e.license.url} />
          </span>
          {e.hint && <span className="catalog-hint">{t(e.hint)}</span>}
        </div>
        <button className="secondary-btn catalog-load" disabled={isLoaded || p.busyId !== null} onClick={() => p.onLoad(e.id)} title={t(e.attribution)}>
          {p.busyId === e.id ? "…" : isLoaded ? "geladen" : "Laden"}
        </button>
      </li>
    );
  };
  const userRow = (e: UserEntry) => {
    const isCached = p.cached.includes(e.id);
    return (
      <li key={e.id} className="catalog-row">
        <div className="catalog-main">
          <span className="catalog-name" title={t(e.attribution)}>
            {t(e.name)}
          </span>
          <span className="catalog-meta">
            {e.space} · {res(e.resolutionMm)} <LicenseBadge c={e.license.class} name={t(e.license.name)} url={e.license.url} />
          </span>
          <span className="catalog-hint">{t(e.instructions)}</span>
        </div>
        <div className="catalog-actions">
          <a className="link-btn" href={e.sourceUrl} target="_blank" rel="noreferrer">
            {t("Zur Quelle")}
          </a>
          {isCached && (
            <>
              <button className="secondary-btn catalog-load" disabled={p.loaded.has(e.id) || p.busyId !== null} onClick={() => p.onLoadCached(e.id)} title={t("Im Browser gespeichert")}>
                {p.loaded.has(e.id) ? "geladen" : "Laden"}
              </button>
              <button className="link-btn" onClick={() => p.onRemoveCached(e.id)} title={t("Gespeicherte Dateien aus diesem Browser entfernen")}>
                {t("entfernen")}
              </button>
            </>
          )}
        </div>
      </li>
    );
  };
  return (
    <div className="brain-catalog">
      <InfoText details={t("Vorlagen für die räumliche Normalisierung (Bereich Standardraum), Gewebekarten und Hirnatlanten im MNI-Raum. Mitgeliefert ist alles, dessen Lizenz die Weitergabe erlaubt; der Name zeigt beim Überfahren die Quelle, das Lizenz-Abzeichen verlinkt auf Lizenz und Zitat. PET-/SPECT-Vorlagen liegen in 1–2 mm vor – feiner ist bei der Auflösung der Geräte nicht sinnvoll. „MNI152 (SPM)“ und „MNI152NLin2009cAsym“ sind beide MNI-Raum, unterscheiden sich aber um wenige Millimeter.")}>
        {t("MNI-Raum, Quellen und Lizenzen je Eintrag")}
      </InfoText>
      {groups.map((g) => (
        <details key={g} className="catalog-group" open={g === "mri"}>
          <summary>
            {t(GROUP_LABELS[g])} <span className="catalog-count">{BUNDLED.filter((e) => e.group === g).length}</span>
          </summary>
          <ul className="catalog-list">{BUNDLED.filter((e) => e.group === g).map(row)}</ul>
        </details>
      ))}
      <details className="catalog-group">
        <summary>
          Selbst herunterladen <span className="catalog-count">{USER_ENTRIES.length}</span>
        </summary>
        <p className="tool-hint">
          {t("Diese Atlanten dürfen nicht mit der App weitergegeben werden (nicht-kommerzielle Lizenz oder Registrierung). Von der Quelle laden und hier auswählen – die App erkennt sie am Dateinamen, setzt Namen und Labels und speichert sie in diesem Browser für das nächste Mal.")}
        </p>
        <ul className="catalog-list">{USER_ENTRIES.map(userRow)}</ul>
        <button className="secondary-btn" onClick={() => fileInput.current?.click()}>
          {t("Heruntergeladene Dateien auswählen …")}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".zip,.nii,.gz,.txt,.csv,.tsv,.lut,.xml"
          onChange={(ev) => {
            const files = [...(ev.target.files ?? [])];
            if (files.length) p.onUserFiles(files);
            ev.target.value = "";
          }}
        />
      </details>
      {p.error && <p className="tool-hint tool-warning">{p.error}</p>}
    </div>
  );
}

/** Atlas selection with load button (bundled atlases; CerebrA 1 mm first). */
export function AtlasPicker({ busy, onLoad }: { busy: boolean; onLoad: (id: string) => void }) {
  const [value, setValue] = useState("cerebra-1");
  return (
    <span className="atlas-picker">
      <select value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("Mitgelieferter Atlas")}>
        {BUNDLED.filter((e) => e.group === "atlas").map((a) => (
          <option key={a.id} value={a.id}>
            {t(a.name)}
          </option>
        ))}
      </select>
      <button className="secondary-btn" disabled={busy} onClick={() => onLoad(value)} title={t(bundledEntry(value)?.attribution ?? "")}>
        {busy ? t("Wird geladen …") : "Atlas laden"}
      </button>
    </span>
  );
}
