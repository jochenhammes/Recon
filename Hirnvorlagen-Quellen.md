# Hirnvorlagen und -atlanten – Quellen, Lizenzen, Aufbereitung

Recherche (11/2026) zu frei verfügbaren MRT-, PET-, SPECT- und CT-Vorlagen sowie Hirnatlanten im MNI-Raum, und wie sie in
Recon Studio eingebunden sind. Bedienung: [Handbuch, Abschnitt 6.4](MANUAL.md#64-vorlagen-und-atlanten-katalog).
Katalog im Code: `src/brain/catalog.ts`. Aufbereitung: `scripts/prepare-brain-assets.py`.

## Grundsatz

- **Mitgeliefert** wird nur, was die Lizenz zur Weitergabe freigibt. Die Lizenz- bzw. README-Datei liegt daneben in
  `public/templates` bzw. `public/atlases`.
- **Nicht-kommerzielle Daten oder Daten mit Registrierung** lädt der Nutzer selbst von der Quelle. Die App erkennt die
  Dateien am Namen und speichert sie nur im Browser des Nutzers (Cache Storage), nie im Repository.
- **Laden zur Laufzeit von fremden Servern ist nicht möglich:** TemplateFlow (S3) sendet keine CORS-Header. Deshalb werden
  alle mitgelieferten Dateien von GitHub Pages ausgeliefert.
- **Auflösung:** MRT-, CT-Vorlagen und Atlanten in 1 mm. PET-/SPECT-Vorlagen in 1–2 mm; feiner ist bei der Auflösung der
  Geräte (4–8 mm FWHM) nicht sinnvoll. 0,5-mm-Vorlagen (z. B. ICBM 2009b) sind im Browser zu groß (~280 MB je Volumen in
  float32) und bringen für PET/SPECT nichts.

## Mitgeliefert

| Datei(en) | Inhalt | Raum / Raster | Lizenz | Zitat |
|---|---|---|---|---|
| `MNI152NLin2009cAsym_res-01_{T1w,T2w,brainmask,label-GM/WM/CSF_probseg}` | T1, T2, Hirnmaske, Gewebekarten | 2009cAsym, 1 mm (193×229×193) | McGill: „use, copy, modify, and distribute … for any purpose and without fee“ mit Copyright-Hinweis | Fonov et al. 2009/2011 |
| `MNI152NLin2009cAsym_res-02_{T1w,brainmask}` | T1, Hirnmaske (vorhanden) | 2009cAsym, 2 mm | wie oben | wie oben |
| `spm12_{PET,SPECT,Transm}` | H₂¹⁵O-PET, Perfusions-SPECT, Transmission (vorhanden) | MNI (SPM), 2 mm | GPL v2+ | SPM12 |
| `magia_{FDG,PiB,raclopride}` | FDG (2 mm), [¹¹C]PiB (1 mm), [¹¹C]Raclopride (1 mm) | MNI (SPM) | MIT (Repository tkkarjal/magia) | Karjalainen et al., Front Neuroinform 2020; 14:3 |
| `spmtemplates_{FPCIT_SPECT,FDOPA_PET}` | ¹²³I-FP-CIT-SPECT, ¹⁸F-DOPA-PET (symmetrisiert) | MNI (SPM), 2 mm | „intended for free use by the neuroimaging community … please cite“ | García-Gómez et al., Rev Esp Med Nucl Imagen Mol 2013; 32:350 |
| `clinical_scct` | Kopf-CT mit Schädel (ältere Erwachsene) | MNI (SPM), 2 mm | BSD-2-Clause (Clinical Toolbox) | Rorden et al., NeuroImage 2012; 61:957 |
| `CerebrA_…_res-01_dseg`, `…_res-02_dseg` | 102 Regionen (Mindboggle-101) | 2009cAsym, 1 / 2 mm | CC0 1.0 | Manera et al., Sci Data 2020; 7:237 |
| `Schaefer2018_{100,200,400}Parcels7Networks_…_res-01_dseg` | kortikale Parzellierung, 7 Netzwerke | 2009cAsym, 1 mm | MIT (CBIG) | Schaefer et al., Cereb Cortex 2018; 28:3095 |
| `MIAL67ThalamicNuclei_…_res-01_dseg` | 14 Thalamuskern-Gruppen | 2009cAsym, 1 mm | CC BY 4.0 | Najdenovska et al., Sci Data 2018; 5:180270 |

Zusammen etwa 63 MB. Geladen wird nur, was angeklickt wird.

**Aufbereitung** (`scripts/prepare-brain-assets.py`):
- Download von TemplateFlow (S3), GitHub (Magia, Clinical Toolbox) und SourceForge (spmtemplates), mit SHA-256-Prüfung
  (`scripts/brain-assets.sha256.json`).
- Umwandlung in little-endian NIfTI-1 mit gzip; Werte unverändert.
- Gewebekarten als uint8 mit scl_slope 1/255; Labelbilder als uint8/uint16.
- CerebrA 1 mm: Das 1-mm-Raster der symmetrischen 2009c-Vorlage ist identisch mit dem der asymmetrischen; die Labels
  sind unverändert.
- Geprüft wurde die Lage aller Dateien im MNI-Raum: Schwerpunkt und Ausdehnung des Gehirns stimmen auf wenige mm
  überein.

## Selbst herunterladen (in der App erkannt)

| Atlas | Lizenz | Quelle | Erkannte Dateien |
|---|---|---|---|
| Harvard-Oxford kortikal/subkortikal | FSL-Lizenz (nicht-kommerziell) | FSL `$FSLDIR/data/atlases` | `HarvardOxford-{cort,sub}-maxprob-thr{0,25,50}-{1,2}mm.nii.gz` + `HarvardOxford-{Cortical,Subcortical}.xml` |
| Harvard-Oxford in MNI 2009c | wie oben | TemplateFlow `tpl-MNI152NLin2009cAsym` | `…_res-0{1,2}_atlas-HO{CPA,CPAL,SPA}_desc-th*_dseg.nii.gz` + `…_atlas-HO*_dseg.tsv` |
| Brainnetome (246) | CC BY-NC-SA | atlas.brainnetome.org | `BN_Atlas_246_{1,2}mm.nii.gz` + `BN_Atlas_246_LUT.txt` |
| AAL3 (170) | laut GIN/CNRS; Seite war aus der Arbeitsumgebung nicht abrufbar, deshalb nicht mitgeliefert | gin.cnrs.fr | AAL3-ZIP oder `AAL3v1[_1mm].nii[.gz]` + `.nii.txt` |
| Jülich-Brain | CC BY-NC-SA 4.0 (EBRAINS) | search.kg.ebrains.eu | Maximum-Probability-Karte (`*julich*mpm*.nii*`) + Tabelle |
| Hammers (83) | akademisch, Registrierung | brain-development.org | `Hammers*.nii*` + Tabelle |

**FSL-XML:** Die Label-Indizes sind 0-basiert, im Bild steht Index + 1 (`parseFslAtlasXml`).

## Geprüft, nicht aufgenommen

- **Muschelli-CT-Vorlage (0,5/1 mm):**
  - CC BY-NC-SA 4.0.
  - Liegt nicht im MNI-Raum (Ursprung 0, eigene Transformation), wäre also erst zu registrieren.
- **FDG-Vorlage Della Rosa et al. 2014:** keine Download-Quelle oder Lizenz gefunden.
- **FDG-PET MNI152 1 mm (Univ. Kopenhagen, Darkner 2013):**
  - „free of charge for all purposes“ bei Zitat.
  - Die Seite war nicht abrufbar, Datei und Raum also nicht geprüft. Kandidat für später.
- **Amyloid- und Tau-Vorlagen (UC Berkeley SCAN, ADNI, Landau et al. 2023):** nicht öffentlich.
  - Alternative: eigene PET-Vorlage, auch adaptiv (4D), in der App laden.
- **TauRUS-Atlas (Figshare):** Lizenz nicht geprüft (Seite nicht abrufbar).
- **CIT168, Melbourne Subcortex Atlas, DiFuMo, MASSP:** Lizenz der Bilddaten nicht eindeutig bestätigt. Später prüfen und
  gegebenenfalls ergänzen.
- **HCP-MMP:** eingeschränkte Lizenz.

## Offene Punkte

- [ ] AAL3-Lizenz am README der Quelle prüfen und bei GPL mitliefern.
- [ ] CIT168 (OSF) und Melbourne Subcortex Atlas: Lizenz der Daten prüfen; beide sind für subkortikale Auswertungen
  (DAT-SPECT) interessant.
- [ ] FDG-Vorlage 1 mm aus Kopenhagen prüfen.
- [ ] Eigene, tracerspezifische 1-mm-Vorlagen sind nur aus eigenen Normalkollektiven möglich. Die App kann dafür ein
  Mittelbild normalisierter Datensätze als Vorlage speichern (Export NIfTI, dann „Eigene PET-Vorlage“).
