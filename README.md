# Recon Studio

Browserbasierte Werkbank für nuklearmedizinische Bilddaten: SPECT-Rohdaten rekonstruieren, PET-, SPECT-,
CT- und MRT-Volumen ansehen, analysieren, bearbeiten, coregistrieren, fusionieren, CT-Organe segmentieren,
die Tumorlast (MTV) bestimmen, in den MNI-Standardraum
normalisieren, regional (SUVR) auswerten und als DICOM oder NIfTI exportieren.
Alles läuft clientseitig im Browser (Web Worker), es gibt keinen Server – die Daten verlassen den Rechner nicht.

## Funktionen

### Daten
- **Volumen laden**: DICOM (einzelne Datei, Multi-Frame oder ganze Serie; unkomprimiert oder JPEG Lossless;
  Explicit/Implicit VR) und NIfTI (`.nii`, `.nii.gz`). Patientenkoordinaten werden aus ImagePositionPatient/
  ImageOrientationPatient (inkl. Functional Groups und NM Detector Information) bzw. NIfTI-sform/qform gelesen,
  Serien nach Position entlang der Schichtnormale sortiert.
- **Beliebig viele Datensätze** (z. B. PET + PET + MRT): einer ist die **Referenz** (Weltraum und Basis der Anzeige),
  einer das **Overlay**; CT/MRT wird als Basis vorgeschlagen. Ein Klick auf einen Datensatz-Chip in der Kopfzeile
  wählt aus, worauf sich Analyse, Bearbeitung, Header und Export beziehen.
- **SPECT-Rekonstruktion** aus Rohdaten (Multi-Frame NM, ein oder zwei Detektorköpfe): FBP mit wählbarem Filter
  oder OSEM, parallel auf einem Worker-Pool.

### Ansicht
- Axial, sagittal, koronar und rotierende MIP, **anatomisch orientiert** (radiologische Konvention, Beschriftung
  R/L/A/P/H/F) unabhängig von der Speicherreihenfolge der Daten.
- Layouts 2×2, 1 groß + 3 klein, Einzelansicht (Doppelklick maximiert); Zoom (Strg+Mausrad), Verschieben
  (Shift/Mitte ziehen), Fenster (rechts ziehen), Schichtwechsel (Mausrad).
- Statusleiste mit Position (mm, LPS) und Werten unter dem Cursor (HU, Bq/ml, SUV).
- Farbtabellen, Fenster-Eingabe und Presets (SUV 0–5/10/15, CT: Weichteil, Lunge, Knochen, Gehirn, Leber).
- Screenshot der aktuellen Ansicht als PNG; dunkles und helles Design.
- **Beliebig viele Overlays** über der Basis, je mit eigener Farbtabelle, eigenem Fenster und eigener Deckkraft;
  Reihenfolge ändern, Ebenen einzeln ein-/ausblenden, Datensatz zur Basis machen. Label-Bilder (Atlas, Organe,
  Läsionen) werden ohne Interpolation dargestellt.
- **GPU-Darstellung (WebGL2)**: Schnittbilder und MIP werden auf der Grafikkarte in Bildschirmauflösung berechnet
  (Volumen als 3D-Texturen); CPU-Weg als Rückfall (kein WebGL2, Software-Rasterizer, zu große Volumina).
  `?renderer=cpu` bzw. `?renderer=gpu` erzwingen einen Weg.
- **Fusion exportieren**: die sichtbaren Ebenen so, wie sie angezeigt werden, als RGB-Datensatz – DICOM Secondary
  Capture (eine Datei je Schicht, ZIP, mit Patientengeometrie) oder NIfTI RGB24, im Raster der Basis oder axial.

### Fusion und Coregistrierung
- Ausrichtung zunächst über die Patientenkoordinaten; Overlay farbig und halbtransparent (Deckkraft, Sichtbarkeit).
- **Automatische Coregistrierung** beliebiger Paare (CT↔PET, PET↔PET, PET↔MRT …), angelehnt an SPM `spm_coreg` und
  FSL FLIRT: Kostenfunktionen Normalisierte Mutual Information (Standard, Histogramm mit Partial-Volume-Verteilung und
  Glättung), Mutual Information, Correlation Ratio, normalisierte Kreuzkorrelation (automatisch für gleiche
  Modalität); robuste Intensitätsskalierung, Mehrstufen-Abtastung (8 → 4 → 2 mm) mit Jitter, Powell-Optimierung
  mit Brent-Liniensuche; **rigide (6) oder affin (12 Parameter)**; optionale Grobsuche (Schwerpunkt + Rotationsraster
  ±30°) für Daten aus verschiedenen Untersuchungen. Läuft im Web Worker mit Fortschritt und Abbruch; Ergebnis
  übernehmen oder verwerfen.
- **Ablauf**: (1) Zielraum wählen – der Basis-Datensatz definiert den Raum; (2) die zu registrierenden Datensätze
  anhaken (Status je Datensatz: Patientenkoordinaten, registriert mit Ähnlichkeitsmaß, Ergebnis prüfen, manuell) und
  nacheinander auf die Basis registrieren; Ergebnisse einzeln oder gemeinsam übernehmen/verwerfen; (3) Einstellungen.
- **Manuelle Feinkorrektur** (Verschiebung/Drehung), Transformationsmatrix als JSON speichern und laden.

### Standardraum (MNI), Atlas und SUVR
- **Vorlagen**: MNI ICBM 152 2009c (asymmetrisch, T1, 2 mm, mit Hirnmaske), SPM12-PET- und SPM12-SPECT-Vorlage
  (Perfusion, für Hirn-PET/SPECT ohne MRT) werden mitgeliefert und bei Bedarf geladen;
  eigene Vorlagen (T1 oder Tracer-PET) können als NIfTI geladen werden.
- **Räumliche Normalisierung** eines Subjekts (meist das T1-MRT, ohne MRT direkt das PET):
  - affin (12 Parameter) mit der Coregistrierungs-Engine (Kreuzkorrelation bei gleichem Kontrast, sonst NMI;
    Grobsuche, optional nur Hirnmaske);
  - **nichtlinear** nach SPM „Normalise“ (Ashburner & Friston 1999): glatte Verformung aus 3D-Kosinus-Basisfunktionen
    (Grenzwellenlänge 30 mm), Summe der quadrierten Differenzen mit Intensitätsskalierung, Biegeenergie-Regularisierung
    (leicht/mittel/stark), Levenberg-Marquardt; Prüfung auf Faltungen (Jacobi-Determinante). Nur bei gleichem Kontrast
    von Subjekt und Vorlage (T1↔T1, PET↔PET-Vorlage).
- **Übertragung**: Das Ergebnis ist ein Rückwärts-Verformungsfeld (Vorlagenvoxel → Subjekt-mm). Jeder Datensatz, der mit
  dem Subjekt coregistriert ist (z. B. PET → T1), wird über seine Matrix und dieses Feld in den Standardraum resampelt
  und als neuer Datensatz angelegt – so wird die MRT-Normalisierung auf das PET übertragen.
- **SPM/CAT12**: Verformungsfelder `y_*.nii` (5D, RAS) importieren (z. B. aus CAT12 – auch auf eigenem Raster wie
  1,5 mm) und die in der App berechnete Normalisierung als `y_*.nii` exportieren; Plausibilitätsprüfung (Feld muss
  in das Bild des Subjekts zeigen, erkennt falsches Subjekt oder inverse `iy_`-Felder).
- **Atlas & SUVR**: mitgelieferter CerebrA-Atlas (102 Regionen, CC0) oder eigener Atlas (Labelbild + Tabelle als
  TXT/CSV/TSV, FSL-/FreeSurfer-LUT oder ITK-SNAP). Regionale Statistik (Volumen, Mittel, Median, SD, Min/Max),
  Referenzregion (Kleinhirnrinde, Kleinhirn gesamt, Pons/Hirnstamm, ganzes Gehirn oder eigene Auswahl), SUVR-Tabelle
  als CSV und **SUVR-Bild** (exportierbar wie jeder Datensatz); Atlas als farbiges Overlay (Farbtabelle „Atlas-Regionen“).

### Analyse
- **Alle geladenen Datensätze** in einer Übersicht (Matrix, Voxelgröße, Min/Mittel/Median/Max, SD, Varianz in der
  jeweiligen Einheit); Klick wählt den Datensatz für die Detailanalyse.
- Anzahl Bildpunkte, Minimum, Mittelwert, Median, Maximum, Standardabweichung, Varianz (Stichprobe, n − 1),
  Histogramm (Bins, log. Skala, ohne unterste Bin).
- **Label-Analyse**: Statistik eines beliebigen Datensatzes je Region einer Segmentierung oder eines Atlas (Volumen,
  Mittel, SD, Varianz, Median, Min, Max; z. B. CT-Organe auf dem PET in SUV), Histogramm einer oder mehrerer Regionen,
  Tabelle als **CSV**. Labels auf anderem Raster werden über die Registrierung übertragen (nächster Nachbar).
  **Histogramme je Label** als CSV (Zeilen = Labels, Spalten = Bins; Bins-Anzahl, Bereich auto/fest, Anzahl oder
  Anteil %), für den gewählten oder für alle Datensätze (ZIP mit einer CSV je Datensatz).
  Hirnatlanten für Daten im MNI-Raum: CerebrA (mitgeliefert) oder **AAL3** (ZIP von
  [gin.cnrs.fr](https://www.gin.cnrs.fr/en/tools/aal/) direkt auswählen; wird nicht mitgeliefert).
- **Labelbilder werden beim erneuten Laden als Atlas erkannt**: Export setzt NIfTI-Intent „Label“ und speichert die
  Regionsnamen im Header; erkannt werden außerdem TotalSegmentator-Ausgaben (Labeltabelle im Header), eine mitgeladene
  Tabelle mit gleichem Namen (z. B. `AAL3v1.nii` + `AAL3v1.nii.txt`) und Dateinamen wie `…_dseg`, `…_seg`, `aseg`.
- Für PET (Einheit BQML) wahlweise in **SUV** (Körpergewicht; zerfallskorrigiert auf Serienstart bzw. Injektion).
- **VOI auf allen Datensätzen**: die gezeichnete VOI wird über die Registrierung auf jeden Datensatz übertragen
  (Volumen, Mittel, Peak, Max).

### Tumorlast (metabolisches Tumorvolumen) und CT-Organsegmentierung
- **CT-Organsegmentierung im Browser**: TotalSegmentator „total“ (3 mm, 117 Strukturen; Apache 2.0) als ONNX-Modell
  mit ONNX Runtime Web (WebGPU, sonst CPU/WASM) – die Daten verlassen den Rechner nicht. Vorverarbeitung wie nnU-Net
  (RAS-Raster 3 mm, CT-Normierung), Sliding Window mit TotalSegmentators Kachelschritt (0,8) und Gauß-gewichteter
  Mittelung der Wahrscheinlichkeiten (Top-4 Klassen je Voxel). Modell (66 MB) wird einmalig geladen und im Browser
  gespeichert. Abgleich mit dem Original-TotalSegmentator (`--fast`) am Beispiel-CT: Dice 0,994–1,000 je Struktur
  (eine Kachel), 99,75 % Voxel-Übereinstimmung bei mehreren Kacheln. Ohne WebGPU dauert ein Ganzkörper-CT lange.
- **Läsionssegmentierung** auf dem PET in SUV: feste Schwelle (Lymphom SUV ≥ 4,0 nach LYSA oder 2,5; PSMA SUV ≥ 3;
  frei), **41 % SUVmax je Läsion** (Region-Growing vom Maximum) oder **Leber-basiert** (a × Mittel + b × SD,
  PERCIST 1,5/2); 26-Nachbar-Zusammenhangskomponenten, Mindestvolumen.
- **Kennzahlen**: Läsionszahl, **TMTV/PSMA-TV**, **TLG/TL-PSMA**, SUVmax/SUVmean, je Läsion Volumen, SUVmax,
  SUVpeak (1 ml), SUVmean; Lymphom zusätzlich **Dmax** und Dmax_bulk (Cottereau et al.); PSMA aufgeteilt in
  Knochen / Weichteil.
- **Mit CT-Organmasken**: Läsionen überwiegend (> 50 %) in Organen mit physiologischer Anreicherung werden
  automatisch ausgeschlossen (FDG: Gehirn, Herz, Nieren, Blase; PSMA: Nieren, Blase, Leber, Milz, Darm, Magen),
  Ort je Läsion (Organ/Knochen), **automatische Leber-Referenz** (3-cm-Kugel im rechten Leberlappen).
  Speichel- und Tränendrüsen sind im CT-Modell nicht enthalten.
- **Korrektur**: Klick schließt Läsionen ein/aus, Pinsel ergänzt/entfernt Voxel; Export als CSV und Läsionsmaske (NIfTI).
- Methodenwahl: Literatur empfiehlt, eine Methode festzulegen und beizubehalten; die gewählte Methode und die
  Ausschlüsse stehen im Ergebnis und in der CSV.

### Centiloid (Amyloid-PET)
- Standard-VOIs (Kortex, Kleinhirn gesamt, Kleinhirnrinde, Pons, Kleinhirn + Hirnstamm) von GAAIN werden vom
  Nutzer geladen (`Centiloid_Std_VOI.zip`; nicht mitgeliefert, GAAIN-Nutzungsbedingungen).
- Pipeline mit MRT (PET → T1 rigide, T1 → MNI) oder PET-only (adaptive PET-Vorlage, 4D-NIfTI); SUVR und Centiloid
  mit der Florbetaben-Gleichung (Rowe et al. 2017), PiB (Klunk et al. 2015) oder einer eigenen Kalibrierung;
  Prüfung von Aufnahmezeitfenster und Tracer aus dem DICOM-Header.
- Validierung gegen die GAAIN-Florbetaben-Daten läuft (siehe unten); bis dahin sind die Werte nicht kalibriert.

### Bearbeiten
- **Werte**: ≥ / ≤ Grenzwert → Wert, Bereich [a, b] → Wert, Begrenzen auf [min, max], linear a·x + b – Eingabe in
  Originaleinheit oder SUV, Vorschau der betroffenen Voxel, Rückfrage bei mehr als 1 %.
- **VOI**: Kugel oder Quader am Fadenkreuz, Pinsel (malen/radieren, schichtweise); grünes Overlay; Statistik
  (Volumen in ml, Mittel, Max, Min, 1-ml-Peak); Werte innen/außen setzen oder skalieren; auf VOI zuschneiden.
- **Filter**: 3D-Gauß-Glättung (FWHM in mm).
- **Geometrie**: Spiegeln (R↔L, A↔P, H↔F), Drehen um 90°/180°, Resampling auf neue Voxelgröße.
- Berechnung im Web Worker; Rückgängig per Neuberechnung aus dem Original (keine Volumenkopien im Speicher).

### DICOM-Header
- Alle Elemente mit Name (eingebautes Wörterbuch), VR und Wert; Suche; Sequenzen aufklappbar; Dateiauswahl bei
  Serien.
- Werte ändern (mit VR-Prüfung), Elemente löschen oder hinzufügen – für alle Dateien oder eine einzelne.
  Tags, die der Export selbst setzt (Pixeldaten, Geometrie, Instanz-UIDs, Meta-Header), sind gesperrt.
- Änderungen werden beim DICOM-Export angewendet.

### Export
- **Header-erhaltend** (DICOM-Quelle, Raster unverändert): alle Elemente werden byte-genau übernommen; neu sind
  PixelData, SOP-/Series-Instance-UID, ImageType = DERIVED, optional SeriesDescription-Zusatz und
  DerivationDescription; Fenster und kleinster/größter Pixelwert werden angepasst. Die Originalkodierung
  (Bit-Tiefe, Rescale Slope/Intercept) bleibt erhalten, neue Werte werden auf das Werteraster gerundet; nur wenn
  Werte außerhalb des darstellbaren Bereichs liegen, wird neu skaliert (Intercept bleibt 0).
- **Neue Serie aus Vorlage** nach Crop, Drehen oder Resampling: Original-Header als Vorlage, Geometrie- und
  Pixel-Tags neu (NM als Multi-Frame inkl. Detector Information).
- **In Zielraum exportieren**: beliebige Datensätze (inkl. Bearbeitungen und Registrierung) in den Raum eines anderen
  Datensatzes resampeln – z. B. PET im MR-Raum oder MRT im PET-Raum – wahlweise mit eigener Matrix- oder Voxelgröße;
  Interpolation nächster Nachbar, trilinear oder kubischer B-Spline; als DICOM-Serie (Header der Quelle, Geometrie und
  Frame of Reference des Ziels) oder NIfTI.
- **NIfTI** mit echter Orientierung (sform/qform); NIfTI-Quellen behalten ihren Original-Header.
- **Anonymisierung** (optional): Patienten-, Betreiber- und Gerätedaten, Freitexte, Private Tags und Auftrags-/
  Referenzsequenzen werden entfernt oder geleert, UIDs ersetzt (auch in erhaltenen Sequenzen); Datum/Uhrzeit und
  optional Gewicht/Größe/Geschlecht/Alter bleiben für die SUV-Berechnung erhalten.
- Serien werden als ZIP exportiert.

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server
npm test         # Unit-Tests (vitest)
npm run lint     # oxlint
npm run build    # Type-Check + Produktions-Build
```

Ein Push auf `main` veröffentlicht die App über GitHub Pages.

## Architektur

- `src/core/` – Patientengeometrie (LPS), Voxel↔Welt-Transformationen, DICOM-/NIfTI-Orientierung, affines
  Transformationsmodell (12 Parameter, Matrix, JSON)
- `src/registration/` – Coregistrierung (Kostenfunktionen, Powell/Brent, Mehrstufen-Ablauf, Worker-Runner)
- `src/normalization/` – Vorlagen, Normalisierungsmodell (Rückwärtsfeld), DCT-Basis und nichtlineare Schätzung,
  SPM/CAT12-`y_*.nii`-Import/Export
- `src/atlas/` – Atlanten, Labeltabellen, Regionalstatistik und SUVR
- `src/tumor/` – Läsionssegmentierung (Schwellen, Zusammenhangskomponenten), Tumorlast-Kennzahlen, Organkopplung
- `src/segmentation/` – CT-Organsegmentierung: Vorverarbeitung, Sliding Window, Modell-Laden/Cache
- `src/centiloid/` – Centiloid-VOIs, Kalibrierungen, synchrone Pipeline für Skripte
- `tools/totalseg-onnx/` – Export des TotalSegmentator-Modells nach ONNX
- `src/resample/` – Interpolation (NN/trilinear/B-Spline), Resampling in Zielraster, eigene Matrix-/Voxelgrößen
- `src/dicom/` – DICOM-Parsing (Rohdaten), Pixel-Dekodierung inkl. JPEG Lossless
- `src/recon/` – Sinogramm, FFT/Rampenfilter, FBP, OSEM
- `src/viewer/` – Volume-Modell, Volumen-Loader, Ebenen-Abtastung im Weltkoordinatensystem, Layer-Komposition, Viewer, MIP,
  WebGL2-Renderer (`gl/`)
- `src/dataset/` – Datenmodell geladener Volumen (Herkunft, Bearbeitungen, Header-Änderungen) und Hilfsfunktionen
- `src/analysis/` – Statistik, Histogramm, SUV
- `src/edit/` – Bearbeitungsoperationen, VOI, Filter, Geometrie-Operationen, Worker-Runner
- `src/header/` – Tag-Wörterbuch, Header-Modell, Validierung
- `src/export/` – header-erhaltender DICOM-Rewriter, Vorlagen-Writer, Anonymisierung, Pixel-Kodierung, NIfTI, ZIP
- `src/workers/` – Worker für Rekonstruktion, Bearbeitung, Coregistrierung, Normalisierung, Resampling,
  Läsionssegmentierung und CT-Segmentierung (ONNX)
- `src/ui/`, `src/components/` – Oberfläche (Shell, Panels)

## Mitgelieferte Daten und Lizenzen

- `public/templates/`: MNI ICBM 152 Nonlinear Asymmetrical 2009c (Fonov et al. 2009/2011), © 1993–2004 Louis Collins,
  McConnell Brain Imaging Centre, MNI, McGill University – Weitergabe mit Copyright-Hinweis erlaubt
  (`LICENSE-MNI152NLin2009cAsym.txt`); bezogen über TemplateFlow.
- `public/atlases/`: CerebrA (Manera et al. 2020, Scientific Data 7:237), CC0 1.0; ursprünglich auf der symmetrischen
  2009c-Vorlage (1 mm) erstellt und für Recon Studio per Mehrheitsentscheid auf das 2-mm-Raster der asymmetrischen
  Vorlage übertragen.
- `public/templates/spm12_PET.nii.gz`, `spm12_SPECT.nii.gz`: PET- (H₂¹⁵O) und SPECT-Perfusionsvorlage aus SPM12
  (`toolbox/OldNorm`, Wellcome Centre for Human Neuroimaging), GNU GPL v2 oder später (`LICENSE-SPM12-GPL.txt`);
  unverändert, nur als little-endian float32 gespeichert.
- `public/models/totalseg-total-3mm/`: TotalSegmentator „total“ 3 mm (Wasserthal et al., Radiology: AI 2023;
  nnU-Net, Isensee et al. 2021), Apache 2.0; unverändert nach ONNX exportiert (`tools/totalseg-onnx/export.py`),
  siehe `NOTICE.txt`.
- Nicht mitgeliefert: GAAIN-Centiloid-Daten und -VOIs (nur persönliche, nicht-kommerzielle, nicht-klinische Nutzung;
  Weitergabe nur mit Genehmigung von LONI/GAAIN).
