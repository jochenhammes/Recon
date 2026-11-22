import { t } from "../i18n";
/**
 * Dosimetry report: a self-contained HTML page (printable as PDF from the browser) with every intermediate result,
 * so that results stay comparable with other software (OpenDose3D, OLINDA, …).
 */

export interface ReportTimePoint {
  label: string;
  acqText: string;
  tH?: number;
  durationSec?: number;
  unit: string;
  calibration: string;
  ct?: string;
  organs?: string;
  lesions?: string;
  registered: string;
  fovMBq?: number;
  pctInjected?: number;
}

export interface ReportRegion {
  name: string;
  volumeMl: number;
  massG: number;
  rc: number;
  t: number[];
  a: number[];
  model: string;
  teffH?: number;
  tia: number;
  tiaSd?: number;
  akaike?: string;
  doseGy: number;
  doseSdGy?: number;
  uncertainty?: string;
  bed?: number;
  dvh?: { mean: number; d2: number; d50: number; d98: number };
  methodCmp?: { led: number; kernel: number };
  curve: (tH: number) => number;
  note?: string;
}

export interface ReportData {
  patientId?: string;
  created: Date;
  nuclide: string;
  halfLife: string;
  electronKeV?: number;
  energySource: string;
  calibration: string;
  injection: string;
  timePoints: ReportTimePoint[];
  regions: ReportRegion[];
  methods: [string, string][];
  uncertaintyInputs: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** " ± sd", omitted when below 0.05 % of the value (exact fits). */
const pm = (sd: number | undefined, v: number) => (sd === undefined || !Number.isFinite(sd) || !(sd >= 5e-4 * Math.abs(v)) ? "" : ` ± ${num(sd, 2)}`);
const num = (v: number | undefined, d = 3) => (v === undefined || !Number.isFinite(v) ? "–" : Number(v.toPrecision(d)).toLocaleString("de-DE"));

/** Small SVG chart: measured activities and the fitted curve over time p.i. */
export function tacSvg(r: Pick<ReportRegion, "t" | "a" | "curve">, w = 260, h = 140): string {
  if (!r.t.length) return "";
  const tMax = Math.max(...r.t) * 1.6 || 1;
  const xs = Array.from({ length: 60 }, (_, i) => (tMax * i) / 59);
  const ys = xs.map((x) => r.curve(x)).map((y) => (Number.isFinite(y) ? y : 0));
  const yMax = Math.max(...r.a, ...ys) * 1.1 || 1;
  const L = 34, B = 20, T = 6, R = 6;
  const X = (t: number) => L + ((w - L - R) * t) / tMax;
  const Y = (a: number) => T + (h - T - B) * (1 - a / yMax);
  const path = xs.map((x, i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-size="9" font-family="sans-serif">
<line x1="${L}" y1="${h - B}" x2="${w - R}" y2="${h - B}" stroke="#888"/><line x1="${L}" y1="${T}" x2="${L}" y2="${h - B}" stroke="#888"/>
<text x="${w - R}" y="${h - 4}" text-anchor="end">${num(tMax, 2)} h</text><text x="${L - 3}" y="${T + 8}" text-anchor="end">${num(yMax, 2)}</text><text x="${L - 3}" y="${h - B}" text-anchor="end">0</text>
<path d="${path}" fill="none" stroke="#7c6cf0" stroke-width="1.5"/>
${r.t.map((t, i) => `<circle cx="${X(t).toFixed(1)}" cy="${Y(r.a[i]).toFixed(1)}" r="3" fill="#e8590c"/>`).join("")}
</svg>`;
}

export function buildReport(d: ReportData): string {
  const row = (cells: (string | number | undefined)[]) => `<tr>${cells.map((c) => `<td>${typeof c === "number" ? num(c) : esc(c ?? "–")}</td>`).join("")}</tr>`;
  const kv = (pairs: [string, string][]) => `<table class="kv">${pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const regionsTable = `<table><thead><tr><th>Region</th><th>Volumen (ml)</th><th>Masse (g)</th><th>RC</th><th>Modell</th><th>T<sub>eff</sub> (h)</th><th>TIA (MBq·h)</th><th>Dosis (Gy)</th><th>BED (Gy)</th><th>D2/D50/D98 (Gy)</th></tr></thead><tbody>${d.regions
    .map((r) =>
      row([
        r.name,
        r.volumeMl,
        r.massG,
        r.rc,
        r.model,
        r.teffH,
        `${num(r.tia)}${pm(r.tiaSd, r.tia)}`,
        `${num(r.doseGy)}${pm(r.doseSdGy, r.doseGy)}`,
        r.bed,
        r.dvh ? `${num(r.dvh.d2)} / ${num(r.dvh.d50)} / ${num(r.dvh.d98)}` : undefined,
      ]),
    )
    .join("")}</tbody></table>`;
  const details = d.regions
    .map(
      (r) => `<section class="region"><h3>${esc(r.name)}</h3><div class="flex">${tacSvg(r)}<div>
<table class="small"><thead><tr><th>t p.i. (h)</th><th>A (MBq)</th></tr></thead><tbody>${r.t.map((t, i) => row([t, r.a[i]])).join("")}</tbody></table>
${kv(
  [
    ["Modell", r.model],
    ["T_eff", r.teffH !== undefined ? `${num(r.teffH)} h` : "–"],
    ["TIA", `${num(r.tia)}${pm(r.tiaSd, r.tia)} MBq·h`],
    ["Dosis", `${num(r.doseGy)}${pm(r.doseSdGy, r.doseGy)} Gy`],
    ...(r.uncertainty ? ([["Unsicherheit (k = 1)", r.uncertainty]] as [string, string][]) : []),
    ...(r.akaike ? ([["Akaike-Gewichte", r.akaike]] as [string, string][]) : []),
    ...(r.dvh ? ([["Voxelkarte", `Mittel ${num(r.dvh.mean)} Gy · D2 ${num(r.dvh.d2)} · D50 ${num(r.dvh.d50)} · D98 ${num(r.dvh.d98)} Gy`]] as [string, string][]) : []),
    ...(r.methodCmp
      ? ([["Lokal / Kernel", `${num(r.methodCmp.led)} / ${num(r.methodCmp.kernel)} Gy (Δ ${num((100 * (r.methodCmp.kernel - r.methodCmp.led)) / r.methodCmp.led, 2)} %)`]] as [string, string][])
      : []),
    ...(r.note ? ([["Hinweis", r.note]] as [string, string][]) : []),
  ],
)}</div></div></section>`,
    )
    .join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Dosimetrie ${esc(d.patientId ?? "")} ${esc(d.nuclide)}</title>
<style>
body{font:12px/1.45 system-ui,sans-serif;color:#111;max-width:1000px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ccc}h3{font-size:13px;margin:12px 0 4px}
table{border-collapse:collapse;margin:4px 0}td,th{border:1px solid #ccc;padding:3px 6px;text-align:right;vertical-align:top}th{background:#f3f3f3}td:first-child,th:first-child{text-align:left}
table.kv th{text-align:left;font-weight:600;background:#fafafa}table.kv td{text-align:left}table.small td,table.small th{padding:2px 5px}
.flex{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}.region{break-inside:avoid}.muted{color:#666}
.warn{border:1px solid #e0a800;background:#fff8e1;padding:6px 10px;margin:10px 0}
@media print{body{margin:0}button{display:none}}
</style></head><body>
<h1>Dosimetrie-Bericht${d.patientId ? ` · ${esc(d.patientId)}` : ""}</h1>
<p class="muted">Erstellt ${esc(d.created.toLocaleString("de-DE"))} mit Recon Studio</p>
<p class="warn">Forschungswerkzeug, kein zertifiziertes Medizinprodukt. Ergebnisse vor klinischer Verwendung unabhängig prüfen.</p>
<h2>Therapie und Kalibrierung</h2>
${kv([
  ["Nuklid", `${d.nuclide} (T½ ${d.halfLife})`],
  ["Elektronenenergie", d.electronKeV !== undefined ? `${num(d.electronKeV, 5)} keV/Zerfall (${d.energySource})` : "–"],
  ["Injektion", d.injection],
  ["Kalibrierung", d.calibration],
  [t("Unsicherheiten (Eingabe)"), d.uncertaintyInputs],
])}
<h2>Zeitpunkte</h2>
<table><thead><tr><th>Zeitpunkt</th><th>Aufnahme</th><th>t p.i. (h)</th><th>Dauer (s)</th><th>Einheit</th><th>MBq/Einheit</th><th>CT</th><th>Organe</th><th>Läsionen</th><th>Registrierung</th><th>Sichtfeld (MBq)</th><th>% inj.</th></tr></thead><tbody>
${d.timePoints.map((t) => row([t.label, t.acqText, t.tH, t.durationSec, t.unit, t.calibration, t.ct, t.organs, t.lesions, t.registered, t.fovMBq, t.pctInjected])).join("")}
</tbody></table>
<h2>Ergebnisse je Region</h2>
${regionsTable}
<h2>Kurven und Details</h2>
${details}
<h2>Methodik</h2>
${kv(d.methods)}
</body></html>`;
}
