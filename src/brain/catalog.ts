import type { TemplateKind } from "../normalization/templates";

/**
 * Catalogue of brain templates, tissue probability maps and atlases in MNI space: the ones bundled with the app
 * (licence allows redistribution, files under public/templates and public/atlases, prepared by
 * scripts/prepare-brain-assets.py) and the ones the user downloads from the source (non-commercial or
 * registration-only licences), which the app recognises by their file names.
 */

export type CatalogGroup = "mri" | "pet" | "ct" | "tpm" | "atlas";

/** free = use and redistribution without conditions beyond the notice; cite = please cite; noncommercial = NC licence. */
export type LicenseClass = "free" | "cite" | "noncommercial";

export interface CatalogLicense {
  class: LicenseClass;
  /** Short name, e.g. "CC0 1.0", "MIT", "GPL v2+". */
  name: string;
  /** Licence/README file next to the data (relative to the app base) or an external URL. */
  url?: string;
}

interface CatalogBase {
  id: string;
  group: CatalogGroup;
  name: string;
  /** Contrast or tracer, e.g. "T1", "FDG-PET", "FP-CIT-SPECT", "CT", "Atlas". */
  modality: string;
  /** Standard space of the grid, e.g. "MNI152NLin2009cAsym" or "MNI152 (SPM)". */
  space: string;
  resolutionMm: number;
  license: CatalogLicense;
  /** Reference / copyright notice shown with the entry. */
  attribution: string;
  hint?: string;
}

export interface BundledEntry extends CatalogBase {
  source: "bundled";
  /** Image path relative to the app base (BASE_URL). */
  file: string;
  /** Brain mask on the same grid (templates). */
  mask?: string;
  /** Label table (atlases): TSV/CSV/LUT. */
  table?: string;
  /** Template contrast for the normalization (templates only). */
  templateKind?: TemplateKind;
  sizeKb: number;
}

export type UserTableFormat = "fsl-xml" | "table";

export interface UserEntry extends CatalogBase {
  source: "user";
  /** Download page of the source. */
  sourceUrl: string;
  /** What to download and which files to select (German, shown in the UI). */
  instructions: string;
  /** File name of the label image (matched against the base name, case-insensitive). */
  image: RegExp;
  /** File name of the label table, if any. */
  table?: RegExp;
  tableFormat?: UserTableFormat;
}

export type CatalogEntry = BundledEntry | UserEntry;

const T = "templates/";
const A = "atlases/";
const MNI_ATTR =
  "ICBM 152 Nonlinear Asymmetrical 2009c (Fonov et al. 2009/2011), © 1993–2004 Louis Collins, McConnell Brain Imaging Centre, MNI, McGill University; via TemplateFlow.";
const MNI_LIC: CatalogLicense = { class: "free", name: "MNI/McGill (frei, mit Copyright-Hinweis)", url: `${T}LICENSE-MNI152NLin2009cAsym.txt` };
const SPM_LIC: CatalogLicense = { class: "free", name: "GPL v2+", url: `${T}LICENSE-SPM12-GPL.txt` };
const SPM_ATTR = "SPM12 (Wellcome Centre for Human Neuroimaging, UCL), toolbox/OldNorm, GNU General Public License v2 oder später.";
const MAGIA_LIC: CatalogLicense = { class: "cite", name: "MIT (Magia)", url: `${T}README-magia.txt` };
const MAGIA_ATTR = "Turku PET Centre / Magia (Karjalainen et al., Front Neuroinform 2020; 14:3), MIT-Lizenz.";
const GG_LIC: CatalogLicense = { class: "cite", name: "frei, bitte zitieren", url: `${T}README-spmtemplates.txt` };
const GG_ATTR =
  "García-Gómez FJ et al., Elaboration of the SPM template for the standardization of SPECT images with 123I-Ioflupane. Rev Esp Med Nucl Imagen Mol 2013; 32(6):350–6 (spmtemplates, SourceForge).";

export const BUNDLED: BundledEntry[] = [
  // ── MRI ──
  { id: "mni-t1-2", source: "bundled", group: "mri", name: "MNI152 2009c T1 (2 mm)", modality: "T1", space: "MNI152NLin2009cAsym", resolutionMm: 2, file: `${T}MNI152NLin2009cAsym_res-02_T1w.nii.gz`, mask: `${T}MNI152NLin2009cAsym_res-02_brainmask.nii.gz`, templateKind: "T1", sizeKb: 1750, license: MNI_LIC, attribution: MNI_ATTR, hint: "Standard für die Normalisierung (Schätzung in 2 mm)" },
  { id: "mni-t1-1", source: "bundled", group: "mri", name: "MNI152 2009c T1 (1 mm)", modality: "T1", space: "MNI152NLin2009cAsym", resolutionMm: 1, file: `${T}MNI152NLin2009cAsym_res-01_T1w.nii.gz`, mask: `${T}MNI152NLin2009cAsym_res-01_brainmask.nii.gz`, templateKind: "T1", sizeKb: 16200, license: MNI_LIC, attribution: MNI_ATTR, hint: "Anzeige und Ausgaberaster 1 mm" },
  { id: "mni-t2-1", source: "bundled", group: "mri", name: "MNI152 2009c T2 (1 mm)", modality: "T2", space: "MNI152NLin2009cAsym", resolutionMm: 1, file: `${T}MNI152NLin2009cAsym_res-01_T2w.nii.gz`, mask: `${T}MNI152NLin2009cAsym_res-01_brainmask.nii.gz`, templateKind: "T1", sizeKb: 15600, license: MNI_LIC, attribution: MNI_ATTR, hint: "für T2-/FLAIR-Aufnahmen (gleicher Kontrast)" },
  // ── PET / SPECT ──
  { id: "spm-pet", source: "bundled", group: "pet", name: "SPM12 PET (H₂¹⁵O-Perfusion, 2 mm)", modality: "Perfusions-PET", space: "MNI152 (SPM)", resolutionMm: 2, file: `${T}spm12_PET.nii.gz`, templateKind: "PET", sizeKb: 870, license: SPM_LIC, attribution: SPM_ATTR, hint: "für Hirn-PET ohne MRT (Perfusion)" },
  { id: "spm-spect", source: "bundled", group: "pet", name: "SPM12 SPECT (Perfusion, 2 mm)", modality: "Perfusions-SPECT", space: "MNI152 (SPM)", resolutionMm: 2, file: `${T}spm12_SPECT.nii.gz`, templateKind: "PET", sizeKb: 1290, license: SPM_LIC, attribution: SPM_ATTR, hint: "für Hirnperfusions-SPECT (HMPAO/ECD)" },
  { id: "magia-fdg", source: "bundled", group: "pet", name: "FDG-PET (Turku/Magia, 2 mm)", modality: "FDG-PET", space: "MNI152 (SPM)", resolutionMm: 2, file: `${T}magia_FDG.nii.gz`, templateKind: "PET", sizeKb: 2470, license: MAGIA_LIC, attribution: MAGIA_ATTR, hint: "für FDG-PET ohne MRT" },
  { id: "magia-pib", source: "bundled", group: "pet", name: "PiB-PET (Turku/Magia, 1 mm)", modality: "Amyloid-PET (PiB)", space: "MNI152 (SPM)", resolutionMm: 1, file: `${T}magia_PiB.nii.gz`, templateKind: "PET", sizeKb: 10400, license: MAGIA_LIC, attribution: MAGIA_ATTR, hint: "für [¹¹C]PiB; für ¹⁸F-Amyloid-Tracer näherungsweise" },
  { id: "magia-raclopride", source: "bundled", group: "pet", name: "Raclopride-PET (Turku/Magia, 1 mm)", modality: "D2-PET (Raclopride)", space: "MNI152 (SPM)", resolutionMm: 1, file: `${T}magia_raclopride.nii.gz`, templateKind: "PET", sizeKb: 9860, license: MAGIA_LIC, attribution: MAGIA_ATTR, hint: "für D2/D3-Rezeptor-PET mit striatalem Muster" },
  { id: "gg-fpcit", source: "bundled", group: "pet", name: "FP-CIT-SPECT (DaTSCAN, 2 mm)", modality: "DAT-SPECT (¹²³I-FP-CIT)", space: "MNI152 (SPM)", resolutionMm: 2, file: `${T}spmtemplates_FPCIT_SPECT.nii.gz`, templateKind: "PET", sizeKb: 690, license: GG_LIC, attribution: GG_ATTR, hint: "für Dopamintransporter-SPECT (30 Kontrollen, symmetrisiert)" },
  { id: "gg-fdopa", source: "bundled", group: "pet", name: "¹⁸F-DOPA-PET (2 mm)", modality: "FDOPA-PET", space: "MNI152 (SPM)", resolutionMm: 2, file: `${T}spmtemplates_FDOPA_PET.nii.gz`, templateKind: "PET", sizeKb: 1610, license: GG_LIC, attribution: GG_ATTR, hint: "für ¹⁸F-DOPA-PET (symmetrisiert)" },
  // ── CT ──
  { id: "spm-transm", source: "bundled", group: "ct", name: "SPM12 Transmission (CT-ähnlich, 2 mm)", modality: "CT", space: "MNI152 (SPM)", resolutionMm: 2, file: `${T}spm12_Transm.nii.gz`, templateKind: "CT", sizeKb: 490, license: SPM_LIC, attribution: SPM_ATTR, hint: "Schwächungsbild mit hellem Knochen (z. B. CT aus PET/CT)" },
  { id: "clinical-scct", source: "bundled", group: "ct", name: "Kopf-CT (Rorden, 2 mm)", modality: "CT", space: "MNI152 (SPM)", resolutionMm: 2, file: `${T}clinical_scct.nii.gz`, templateKind: "CT", sizeKb: 650, license: { class: "free", name: "BSD-2-Clause", url: `${T}LICENSE-Clinical-BSD.txt` }, attribution: "Rorden C et al., Age-specific CT and MRI templates for spatial normalization. NeuroImage 2012; 61:957–965 (Clinical Toolbox, BSD-2-Clause).", hint: "CT-Vorlage aus älteren Erwachsenen, mit Schädel" },
  // ── Tissue probability maps ──
  ...(["GM", "WM", "CSF"] as const).map(
    (l): BundledEntry => ({
      id: `mni-${l.toLowerCase()}-1`,
      source: "bundled",
      group: "tpm",
      name: `${{ GM: "Graue Substanz", WM: "Weiße Substanz", CSF: "Liquor" }[l]} (${l}, 1 mm)`,
      modality: "Gewebewahrscheinlichkeit",
      space: "MNI152NLin2009cAsym",
      resolutionMm: 1,
      file: `${T}MNI152NLin2009cAsym_res-01_label-${l}_probseg.nii.gz`,
      sizeKb: { GM: 1970, WM: 1690, CSF: 1180 }[l],
      license: MNI_LIC,
      attribution: MNI_ATTR,
      hint: l === "GM" ? "auch als Maske für die Atlas-Statistik („nur graue Substanz“)" : undefined,
    }),
  ),
  // ── Atlases ──
  { id: "cerebra-1", source: "bundled", group: "atlas", name: "CerebrA (102 Regionen, 1 mm)", modality: "Atlas", space: "MNI152NLin2009cAsym", resolutionMm: 1, file: `${A}CerebrA_MNI152NLin2009cAsym_res-01_dseg.nii.gz`, table: `${A}CerebrA_labels.tsv`, sizeKb: 260, license: { class: "free", name: "CC0 1.0", url: `${A}README-CerebrA.txt` }, attribution: "CerebrA (Manera et al. 2020, Sci Data 7:237), CC0 1.0; auf MNI-ICBM2009c symmetrisch erstellt (1-mm-Raster identisch mit der asymmetrischen Vorlage).", hint: "anatomisch (Mindboggle-101), Standard" },
  { id: "cerebra-2", source: "bundled", group: "atlas", name: "CerebrA (102 Regionen, 2 mm)", modality: "Atlas", space: "MNI152NLin2009cAsym", resolutionMm: 2, file: `${A}CerebrA_MNI152NLin2009cAsym_res-02_dseg.nii.gz`, table: `${A}CerebrA_labels.tsv`, sizeKb: 40, license: { class: "free", name: "CC0 1.0", url: `${A}README-CerebrA.txt` }, attribution: "CerebrA (Manera et al. 2020, Sci Data 7:237), CC0 1.0; für Recon Studio auf das 2-mm-Raster der asymmetrischen Vorlage übertragen." },
  ...([100, 200, 400] as const).map(
    (n): BundledEntry => ({
      id: `schaefer-${n}`,
      source: "bundled",
      group: "atlas",
      name: `Schaefer 2018 (${n} Parzellen, 7 Netzwerke, 1 mm)`,
      modality: "Atlas (funktionell)",
      space: "MNI152NLin2009cAsym",
      resolutionMm: 1,
      file: `${A}Schaefer2018_${n}Parcels7Networks_MNI152NLin2009cAsym_res-01_dseg.nii.gz`,
      table: `${A}Schaefer2018_${n}Parcels7Networks_labels.tsv`,
      sizeKb: { 100: 190, 200: 210, 400: 250 }[n],
      license: { class: "free", name: "MIT", url: `${A}README-Schaefer2018.txt` },
      attribution: "Schaefer A et al., Local-Global Parcellation of the Human Cerebral Cortex from Intrinsic Functional Connectivity MRI. Cereb Cortex 2018; 28:3095–3114 (CBIG, MIT); via TemplateFlow.",
      hint: "nur Kortex, nach Ruhe-Netzwerken (Yeo 7)",
    }),
  ),
  { id: "mial67-1", source: "bundled", group: "atlas", name: "Thalamuskerne MIAL67 (1 mm)", modality: "Atlas (Thalamus)", space: "MNI152NLin2009cAsym", resolutionMm: 1, file: `${A}MIAL67ThalamicNuclei_MNI152NLin2009cAsym_res-01_dseg.nii.gz`, table: `${A}MIAL67ThalamicNuclei_labels.tsv`, sizeKb: 15, license: { class: "cite", name: "CC BY 4.0", url: `${A}README-MIAL67.txt` }, attribution: "Najdenovska E et al., In-vivo probabilistic atlas of human thalamic nuclei based on diffusion-weighted MRI. Sci Data 2018; 5:180270 (CC BY 4.0); via TemplateFlow.", hint: "7 Kerngruppen je Seite" },
];

const FSL_LIC: CatalogLicense = { class: "noncommercial", name: "FSL-Lizenz (nicht-kommerziell)", url: "https://fsl.fmrib.ox.ac.uk/fsl/docs/license.html" };

export const USER_ENTRIES: UserEntry[] = [
  {
    id: "ho-cort",
    source: "user",
    group: "atlas",
    name: "Harvard-Oxford kortikal (48 Regionen)",
    modality: "Atlas",
    space: "MNI152NLin6Asym (FSL)",
    resolutionMm: 1,
    license: FSL_LIC,
    attribution: "Harvard-Oxford-Atlas (Desikan et al. 2006; Harvard Center for Morphometric Analysis), Teil von FSL.",
    sourceUrl: "https://fsl.fmrib.ox.ac.uk/fsl/docs/other/datasets.html",
    instructions: "Aus einer FSL-Installation ($FSLDIR/data/atlases) „HarvardOxford/HarvardOxford-cort-maxprob-thr25-1mm.nii.gz“ und „HarvardOxford-Cortical.xml“ zusammen auswählen.",
    image: /^harvardoxford-cort(l)?-maxprob-thr(0|25|50)-(1|2)mm\.nii(\.gz)?$/i,
    table: /^harvardoxford-cortical(-lateralized)?\.xml$/i,
    tableFormat: "fsl-xml",
  },
  {
    id: "ho-sub",
    source: "user",
    group: "atlas",
    name: "Harvard-Oxford subkortikal (21 Regionen)",
    modality: "Atlas",
    space: "MNI152NLin6Asym (FSL)",
    resolutionMm: 1,
    license: FSL_LIC,
    attribution: "Harvard-Oxford-Atlas (Harvard Center for Morphometric Analysis), Teil von FSL.",
    sourceUrl: "https://fsl.fmrib.ox.ac.uk/fsl/docs/other/datasets.html",
    instructions: "Aus $FSLDIR/data/atlases „HarvardOxford/HarvardOxford-sub-maxprob-thr25-1mm.nii.gz“ und „HarvardOxford-Subcortical.xml“ zusammen auswählen.",
    image: /^harvardoxford-sub-maxprob-thr(0|25|50)-(1|2)mm\.nii(\.gz)?$/i,
    table: /^harvardoxford-subcortical\.xml$/i,
    tableFormat: "fsl-xml",
  },
  {
    id: "ho-tf",
    source: "user",
    group: "atlas",
    name: "Harvard-Oxford (TemplateFlow, MNI 2009c)",
    modality: "Atlas",
    space: "MNI152NLin2009cAsym",
    resolutionMm: 1,
    license: FSL_LIC,
    attribution: "Harvard-Oxford-Atlas (FSL), von TemplateFlow nach MNI152NLin2009cAsym übertragen.",
    sourceUrl: "https://www.templateflow.org/browse/",
    instructions: "Bei TemplateFlow (tpl-MNI152NLin2009cAsym) z. B. „…_res-01_atlas-HOCPA_desc-th25_dseg.nii.gz“ und die passende „…_atlas-HOCPA_dseg.tsv“ laden und zusammen auswählen.",
    image: /^tpl-mni152nlin2009casym_res-0?[12]_atlas-ho(cpa|cpal|spa)_desc-th\d+_dseg\.nii(\.gz)?$/i,
    table: /^tpl-mni152nlin2009casym_atlas-ho(cpa|cpal|spa)_dseg\.tsv$/i,
    tableFormat: "table",
  },
  {
    id: "brainnetome",
    source: "user",
    group: "atlas",
    name: "Brainnetome (246 Regionen)",
    modality: "Atlas",
    space: "MNI152 (FSL)",
    resolutionMm: 1,
    license: { class: "noncommercial", name: "CC BY-NC-SA 3.0", url: "https://atlas.brainnetome.org" },
    attribution: "Fan L et al., The Human Brainnetome Atlas. Cereb Cortex 2016; 26:3508–3526.",
    sourceUrl: "https://atlas.brainnetome.org/download.html",
    instructions: "„BN_Atlas_246_1mm.nii.gz“ und die Tabelle „BN_Atlas_246_LUT.txt“ zusammen auswählen.",
    image: /^bn_atlas_246_(1|2)mm\.nii(\.gz)?$/i,
    table: /^bn_atlas_246_lut\.txt$/i,
    tableFormat: "table",
  },
  {
    id: "aal3",
    source: "user",
    group: "atlas",
    name: "AAL3 (170 Regionen)",
    modality: "Atlas",
    space: "MNI152 (SPM)",
    resolutionMm: 1,
    license: { class: "cite", name: "laut Herausgeber (GIN, CNRS)", url: "https://www.gin.cnrs.fr/en/tools/aal/" },
    attribution: "Rolls ET, Huang CC, Lin CP, Feng J, Joliot M. Automated anatomical labelling atlas 3. NeuroImage 2020; 206:116189.",
    sourceUrl: "https://www.gin.cnrs.fr/en/tools/aal/",
    instructions: "Das AAL3-ZIP direkt auswählen, oder „AAL3v1_1mm.nii.gz“ mit „AAL3v1_1mm.nii.txt“.",
    image: /^aal3v\d+(_1mm)?\.nii(\.gz)?$/i,
    table: /^aal3v\d+(_1mm)?\.nii\.txt$/i,
    tableFormat: "table",
  },
  {
    id: "julich",
    source: "user",
    group: "atlas",
    name: "Jülich-Brain (zytoarchitektonisch)",
    modality: "Atlas",
    space: "MNI152NLin2009cAsym",
    resolutionMm: 1,
    license: { class: "noncommercial", name: "CC BY-NC-SA 4.0", url: "https://search.kg.ebrains.eu" },
    attribution: "Amunts K et al., Julich-Brain: A 3D probabilistic atlas of the human brain's cytoarchitecture. Science 2020; 369:988–992 (EBRAINS).",
    sourceUrl: "https://search.kg.ebrains.eu/?category=Dataset&q=julich-brain%20maximum%20probability",
    instructions: "Die Maximum-Probability-Karte im MNI152-2009c-Raum (NIfTI) mit der zugehörigen Labeltabelle (.txt/.xml/.tsv) auswählen.",
    image: /julich.*(mpm|maxprob|maximum).*\.nii(\.gz)?$/i,
    table: /julich.*\.(txt|tsv|csv|xml|lut)$/i,
    tableFormat: "table",
  },
  {
    id: "hammers",
    source: "user",
    group: "atlas",
    name: "Hammers (83 Regionen)",
    modality: "Atlas",
    space: "MNI152 (SPM)",
    resolutionMm: 1,
    license: { class: "noncommercial", name: "akademisch, Registrierung", url: "https://brain-development.org/brain-atlases/" },
    attribution: "Hammers A et al., Three-dimensional maximum probability atlas of the human brain. Hum Brain Mapp 2003; 19:224–247; Gousias et al. 2008.",
    sourceUrl: "https://brain-development.org/brain-atlases/adult-brain-atlases/",
    instructions: "Das Maximum-Probability-Labelbild im MNI-Raum (z. B. „Hammers_mith_atlas_n30r83_SPM5.nii.gz“) und die Labeltabelle auswählen.",
    image: /^hammers.*\.nii(\.gz)?$/i,
    table: /^hammers.*\.(txt|tsv|csv|xml)$/i,
    tableFormat: "table",
  },
];

export const CATALOG: CatalogEntry[] = [...BUNDLED, ...USER_ENTRIES];

export const catalogEntry = (id: string | undefined): CatalogEntry | undefined => CATALOG.find((e) => e.id === id);
export const bundledEntry = (id: string | undefined): BundledEntry | undefined => BUNDLED.find((e) => e.id === id);

export const GROUP_LABELS: Record<CatalogGroup, string> = {
  mri: "MRT-Vorlagen",
  pet: "PET- und SPECT-Vorlagen",
  ct: "CT-Vorlagen",
  tpm: "Gewebekarten",
  atlas: "Atlanten",
};

export const LICENSE_LABELS: Record<LicenseClass, string> = { free: "frei", cite: "frei, zitieren", noncommercial: "nicht-kommerziell" };

const baseName = (n: string) => n.split(/[\\/]/).pop()!;

/**
 * Recognises user-downloaded catalogue files by their names: returns the entry together with the image and
 * (optional) table among `names`, or null.
 */
export function identifyUserFiles(names: string[]): { entry: UserEntry; image: string; table?: string } | null {
  for (const entry of USER_ENTRIES) {
    const image = names.find((n) => entry.image.test(baseName(n)));
    if (!image) continue;
    const table = entry.table ? names.find((n) => entry.table!.test(baseName(n))) : undefined;
    return { entry, image, table };
  }
  return null;
}

/** Default template for a subject: by contrast, modality and (for SPECT) tracer hints from the header. */
export function defaultTemplateId(o: { kind: TemplateKind; modality: string; tracerHint?: string }): string {
  if (o.kind === "T1") return "mni-t1-2";
  if (o.kind === "CT") return "spm-transm";
  const h = (o.tracerHint ?? "").toLowerCase();
  if (/fp-?cit|ioflupan|datscan|dat\b|β-?cit|beta-?cit/.test(h)) return "gg-fpcit";
  if (/dopa/.test(h)) return "gg-fdopa";
  if (/raclopride/.test(h)) return "magia-raclopride";
  if (/pib|pittsburgh|amyloid|florbeta|flutemetamol|amyvid|vizamyl|neuraceq/.test(h)) return "magia-pib";
  if (/fdg|fluorodeoxy|deoxyglucose/.test(h)) return "magia-fdg";
  return o.modality === "NM" ? "spm-spect" : "magia-fdg";
}
