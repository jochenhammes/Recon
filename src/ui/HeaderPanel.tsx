import { ChevronDown, ChevronRight, Pencil, Trash2, Undo2 } from "lucide-react";
import { InfoText } from "./Info";
import { useMemo, useState } from "react";
import type { LoadedDataset } from "../dataset/types";
import { IMPLICIT_VR_LE } from "../export/dicomRewriter";
import { formatTag, lookupTag, parseTag } from "../header/dictionary";
import { NUCLIDES, RP_SEQUENCE, currentNuclide, nuclideEdit, readNuclideEdit } from "../header/radionuclide";
import { Card } from "./Card";
import { EDITABLE_VRS, type HeaderEdit, type HeaderRow, headerRows, lockReason, validateValue } from "../header/headerModel";

import { t } from "../i18n";
export interface HeaderPanelProps {
  dataset: LoadedDataset;
  onEditsChange: (edits: HeaderEdit[]) => void;
}

/** The edit that applies to a tag in a given file (last matching edit wins). */
function effectiveEdit(edits: HeaderEdit[], tag: string, fileIndex: number): HeaderEdit | undefined {
  let hit: HeaderEdit | undefined;
  for (const e of edits) if (e.tag === tag && e.vr !== "SQ" && (e.scope === "all" || e.scope === fileIndex)) hit = e;
  return hit;
}

export function HeaderPanel({ dataset, onEditsChange }: HeaderPanelProps) {
  const source = dataset.source;
  const [fileIndex, setFileIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const edits = dataset.headerEdits;

  const files = source.kind === "dicom" ? source.files : [];
  const file = files[Math.min(fileIndex, files.length - 1)];
  const rows = useMemo(() => (file ? headerRows(file.dataSet, file.transferSyntax !== IMPLICIT_VR_LE) : []), [file]);

  if (source.kind !== "dicom" || !file) {
    return <p className="tool-hint">{t("Der Header-Editor steht für DICOM-Datensätze zur Verfügung.")}</p>;
  }

  // Rows for tags added by edits that do not exist in the file yet.
  const existing = new Set(rows.map((r) => r.tag));
  const added: HeaderRow[] = [];
  for (const e of edits)
    if (e.vr !== "SQ" && !existing.has(e.tag) && !added.some((r) => r.tag === e.tag) && effectiveEdit(edits, e.tag, fileIndex)?.value != null)
      added.push({ tag: e.tag, name: lookupTag(e.tag)?.name ?? "", vr: e.vr, value: "", editable: true });
  const allRows = [...rows, ...added].sort((a, b) => (a.tag < b.tag ? -1 : 1));

  const q = query.trim().toLowerCase();
  const visible = q
    ? allRows.filter((r) => {
        const e = effectiveEdit(edits, r.tag, fileIndex);
        return (
          formatTag(r.tag).toLowerCase().includes(q) ||
          r.tag.includes(q.replace(/[(),\s]/g, "")) ||
          r.name.toLowerCase().includes(q) ||
          r.value.toLowerCase().includes(q) ||
          (e?.value ?? "").toLowerCase().includes(q)
        );
      })
    : allRows;

  function addEdit(edit: HeaderEdit) {
    // Replace an earlier edit of the same tag and scope.
    onEditsChange([...edits.filter((e) => !(e.tag === edit.tag && e.scope === edit.scope)), edit]);
    setEditing(null);
  }

  return (
    <div className="header-panel">
      <section className="card">
        {files.length > 1 && (
          <label className="field">
            Datei {fileIndex + 1} von {files.length} · {file.fileName}
            <input type="range" min={0} max={files.length - 1} value={fileIndex} onChange={(e) => setFileIndex(Number(e.target.value))} />
          </label>
        )}
        <label className="field">
          Suche (Tag, Name oder Wert)
          <input type="text" value={query} placeholder={t("z. B. 0010,0010 oder Patient")} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <InfoText details={t("Gesperrt sind Tags, die der Export selbst setzt (Pixeldaten, Geometrie, Instanz-UIDs, Meta-Header).")}>{t("Änderungen wirken beim DICOM-Export.")}</InfoText>
      </section>

      <NuclideCard dataSet={file.dataSet} edits={edits} onChange={onEditsChange} />

      <div className="tag-table" role="table" aria-label={t("DICOM-Header")}>
        {visible.map((r) => (
          <TagRowView
            key={r.tag}
            row={r}
            edit={effectiveEdit(edits, r.tag, fileIndex)}
            editing={editing === r.tag}
            expanded={expanded.has(r.tag)}
            seriesSize={files.length}
            fileIndex={fileIndex}
            onToggle={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(r.tag)) next.delete(r.tag);
                else next.add(r.tag);
                return next;
              })
            }
            onStartEdit={() => setEditing(r.tag)}
            onCancel={() => setEditing(null)}
            onSave={addEdit}
          />
        ))}
        {visible.length === 0 && <p className="tool-hint">{t("Keine Treffer.")}</p>}
      </div>

      <AddTagForm seriesSize={files.length} fileIndex={fileIndex} onAdd={addEdit} />

      {edits.length > 0 && (
        <section className="card">
          <h3>Offene Änderungen ({edits.length})</h3>
          <ul className="pending-edits">
            {edits.map((e, i) => (
              <li key={`${e.tag}-${e.scope}-${i}`}>
                <span>
                  <code>{formatTag(e.tag)}</code> {lookupTag(e.tag)?.name ?? ""}:{" "}
                  {e.vr === "SQ" && e.tag === RP_SEQUENCE ? (
                    <strong>Radionuklid {readNuclideEdit([e])?.nuclide ?? "?"}</strong>
                  ) : e.value === null ? (
                    <em>{t("löschen")}</em>
                  ) : (
                    <strong>{e.value || "(leer)"}</strong>
                  )}
                  <span className="scope-note">{e.scope === "all" ? t(" · alle Dateien") : t(" · nur Datei {v}", { v: e.scope + 1 })}</span>
                </span>
                <button className="icon-btn small" title={t("Änderung verwerfen")} aria-label={t("Änderung verwerfen")} onClick={() => onEditsChange(edits.filter((_, j) => j !== i))}>
                  <Undo2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <button className="secondary-btn" onClick={() => onEditsChange([])}>
            {t("Alle Änderungen verwerfen")}
          </button>
        </section>
      )}
    </div>
  );
}

interface TagRowViewProps {
  row: HeaderRow;
  edit?: HeaderEdit;
  editing: boolean;
  expanded: boolean;
  seriesSize: number;
  fileIndex: number;
  onToggle: () => void;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (e: HeaderEdit) => void;
}

function TagRowView({ row, edit, editing, expanded, seriesSize, fileIndex, onToggle, onStartEdit, onCancel, onSave }: TagRowViewProps) {
  const deleted = edit?.value === null;
  const shownValue = edit && edit.value !== null ? edit.value : row.value;
  return (
    <div className={`tag-row${edit ? (deleted ? " deleted" : " changed") : ""}`} role="row">
      <div className="tag-row-head">
        {row.items ? (
          <button className="tag-toggle" aria-label={expanded ? "Zuklappen" : "Aufklappen"} onClick={onToggle}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="tag-toggle" />
        )}
        <code className="tag-id">{formatTag(row.tag)}</code>
        <span className="tag-vr">{row.vr}</span>
        <span className="tag-name" title={row.name}>
          {row.name || "–"}
        </span>
        {row.editable && !editing && (
          <button className="icon-btn small" title={t("Bearbeiten")} aria-label={t("{v} bearbeiten", { v: row.name || formatTag(row.tag) })} onClick={onStartEdit}>
            <Pencil size={12} />
          </button>
        )}
      </div>
      {!editing && <div className="tag-value" title={row.lockReason}>{deleted ? t("(wird gelöscht)") : shownValue || <span className="empty">{t("(leer)")}</span>}</div>}
      {editing && (
        <TagEditor
          tag={row.tag}
          vr={row.vr}
          initial={edit && edit.value !== null ? edit.value : row.value}
          seriesSize={seriesSize}
          fileIndex={fileIndex}
          onCancel={onCancel}
          onSave={onSave}
        />
      )}
      {expanded && row.items && (
        <div className="tag-items">
          {row.items.map((item, i) => (
            <div key={i} className="tag-item">
              <div className="tag-item-label">Element {i + 1}</div>
              {item.map((r) => (
                <div key={r.tag} className="tag-row nested">
                  <div className="tag-row-head">
                    <code className="tag-id">{formatTag(r.tag)}</code>
                    <span className="tag-vr">{r.vr}</span>
                    <span className="tag-name">{r.name || "–"}</span>
                  </div>
                  <div className="tag-value">{r.value}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagEditor(props: { tag: string; vr: string; initial: string; seriesSize: number; fileIndex: number; onCancel: () => void; onSave: (e: HeaderEdit) => void }) {
  const [value, setValue] = useState(props.initial.replace(/ … \(\d+ Werte\)$/, ""));
  const [scope, setScope] = useState<"all" | "file">("all");
  const error = validateValue(props.vr, value);
  const resolvedScope = scope === "all" ? "all" : props.fileIndex;
  const long = props.vr === "LT" || props.vr === "ST" || props.vr === "UT";
  return (
    <div className="tag-editor">
      {long ? (
        <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <input type="text" value={value} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !error && props.onSave({ tag: props.tag, vr: props.vr, value, scope: resolvedScope })} />
      )}
      {error && <div className="field-error">{error}</div>}
      {props.seriesSize > 1 && (
        <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "file")}>
          <option value="all">für alle {props.seriesSize} Dateien</option>
          <option value="file">nur für Datei {props.fileIndex + 1}</option>
        </select>
      )}
      <div className="button-row">
        <button className="secondary-btn" disabled={!!error} onClick={() => props.onSave({ tag: props.tag, vr: props.vr, value, scope: resolvedScope })}>
          {t("Übernehmen")}
        </button>
        <button className="secondary-btn" title={t("Element beim Export entfernen")} onClick={() => props.onSave({ tag: props.tag, vr: props.vr, value: null, scope: resolvedScope })}>
          <Trash2 size={13} /> Löschen
        </button>
        <button className="secondary-btn" onClick={props.onCancel}>
          {t("Abbrechen")}
        </button>
      </div>
    </div>
  );
}

function AddTagForm({ seriesSize, fileIndex, onAdd }: { seriesSize: number; fileIndex: number; onAdd: (e: HeaderEdit) => void }) {
  const [tagText, setTagText] = useState("");
  const [vr, setVr] = useState("LO");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<"all" | "file">("all");
  const tag = parseTag(tagText);
  const known = tag ? lookupTag(tag) : undefined;
  const effectiveVr = known && EDITABLE_VRS.has(known.vr) ? known.vr : vr;
  const lock = tag ? lockReason(tag) : undefined;
  const error = !tagText ? null : !tag ? t("Tag im Format gggg,eeee angeben.") : lock ?? (known && !EDITABLE_VRS.has(known.vr) ? t("VR {vr} ist nicht editierbar.", { vr: known.vr }) : validateValue(effectiveVr, value));
  return (
    <section className="card">
      <h3>{t("Tag hinzufügen / setzen")}</h3>
      <div className="field-row">
        <label className="field">
          {t("Tag")}
          <input type="text" value={tagText} placeholder="0010,1030" onChange={(e) => setTagText(e.target.value)} />
        </label>
        <label className="field">
          VR
          <select value={effectiveVr} disabled={!!known} onChange={(e) => setVr(e.target.value)}>
            {[...EDITABLE_VRS].sort().map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {known && <p className="tool-hint">{known.name}</p>}
      <label className="field">
        {t("Wert")}
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {seriesSize > 1 && (
        <label className="field">
          {t("Geltungsbereich")}
          <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "file")}>
            <option value="all">alle {seriesSize} Dateien</option>
            <option value="file">nur Datei {fileIndex + 1}</option>
          </select>
        </label>
      )}
      {error && <div className="field-error">{error}</div>}
      <button
        className="secondary-btn"
        disabled={!tag || !!error}
        onClick={() => {
          if (!tag) return;
          onAdd({ tag, vr: effectiveVr, value, scope: scope === "all" ? "all" : fileIndex });
          setTagText("");
          setValue("");
        }}
      >
        {t("Hinzufügen")}
      </button>
    </section>
  );
}

/** Radionuclide of the series: shows the current one, sets another one (with half-life etc.) for the export. */
function NuclideCard({ dataSet, edits, onChange }: { dataSet: import("dicom-parser").DataSet; edits: HeaderEdit[]; onChange: (e: HeaderEdit[]) => void }) {
  const cur = useMemo(() => currentNuclide(dataSet), [dataSet]);
  const pending = readNuclideEdit(edits);
  const [choice, setChoice] = useState(pending?.nuclide ?? cur.match?.id ?? "F-18");
  const [pharma, setPharma] = useState(pending?.radiopharmaceutical ?? "");
  const n = NUCLIDES.find((x) => x.id === choice)!;
  const fmtHl = (sec?: number) => (sec ? `${sec.toLocaleString("de-DE", { maximumFractionDigits: 1 })} s` : "–");
  const others = edits.filter((e) => !(e.tag === RP_SEQUENCE && e.vr === "SQ"));
  return (
    <Card
      title={<>{t("Radionuklid")}</>}
      status={pending ? { text: `→ ${pending.nuclide}`, tone: "run" } : cur.match ? { text: cur.match.id, tone: "info" } : null}
      info={
        <>
          <p>
            Ändert das Radionuklid der Serie in der <em>{t("Radiopharmaceutical Information Sequence")}</em> (0054,0016): Nuklid-Code (0054,0300), Halbwertszeit
            (0018,1075) und Positronenanteil (0018,1076), optional das Radiopharmazeutikum (0018,0031). Dosis, Injektionszeit und alle übrigen Angaben
            bleiben unverändert.
          </p>
          <p>
            Wirkt beim DICOM-Export auf alle Dateien der Serie und sofort auf die SUV-Berechnung in der App (Zerfallskorrektur mit der neuen
            Halbwertszeit). Der Nuklid-Code ist der SNOMED-CT-Code aus dem DICOM-Standard (Schema „SCT“, z. B. 77004003 „^18^Fluorine“); für Tb-161 gibt es dort keinen Code, es wird das private Schema „99RECON“ verwendet.
          </p>
        </>
      }
    >
      <p className="tool-hint">
        Aktuell: {cur.meaning ?? t("kein Nuklid-Code")} · T½ {fmtHl(cur.halfLifeSec)}
        {cur.positronFraction !== undefined ? ` · β⁺ ${cur.positronFraction.toLocaleString("de-DE")}` : ""}
        {cur.radiopharmaceutical ? ` · ${cur.radiopharmaceutical}` : ""}
      </p>
      <label className="field">
        {t("Neues Radionuklid")}
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {NUCLIDES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} – T½ {x.halfLifeText}
              {x.positronFraction >= 0.01 ? `, β⁺ ${Math.round(x.positronFraction * 1000) / 10} %` : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="tool-hint">
        Wird geschrieben: {n.meaning} ({n.code ? `SCT ${n.code}` : "privater Code"}) · Halbwertszeit {fmtHl(n.halfLifeSec)} · Positronenanteil {n.positronFraction.toLocaleString("de-DE")}
      </p>
      <label className="field">
        Radiopharmazeutikum (optional, z. B. PSMA-1007)
        <input type="text" value={pharma} maxLength={64} placeholder={cur.radiopharmaceutical ?? ""} onChange={(e) => setPharma(e.target.value)} />
      </label>
      <div className="button-row">
        <button className="secondary-btn" onClick={() => onChange([...others, nuclideEdit({ nuclide: choice, ...(pharma.trim() ? { radiopharmaceutical: pharma.trim() } : {}) })])}>
          {pending ? t("Änderung aktualisieren") : t("Nuklid übernehmen")}
        </button>
        {pending && (
          <button className="secondary-btn" onClick={() => onChange(others)}>
            {t("Verwerfen")}
          </button>
        )}
      </div>
    </Card>
  );
}
