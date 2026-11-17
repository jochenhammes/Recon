# Recon Studio

Browserbasierte Werkbank für nuklearmedizinische Bilddaten: SPECT-Rohdaten rekonstruieren, PET-, SPECT- und
CT- oder MRT-Volumen ansehen, analysieren, bearbeiten, coregistrieren, fusionieren und als DICOM oder NIfTI exportieren.
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

### Fusion und Coregistrierung
- Ausrichtung zunächst über die Patientenkoordinaten; Overlay farbig und halbtransparent (Deckkraft, Sichtbarkeit).
- **Automatische Coregistrierung** beliebiger Paare (CT↔PET, PET↔PET, PET↔MRT …), angelehnt an SPM `spm_coreg` und
  FSL FLIRT: Kostenfunktionen Normalisierte Mutual Information (Standard, Histogramm mit Partial-Volume-Verteilung und
  Glättung), Mutual Information, Correlation Ratio, normalisierte Kreuzkorrelation (automatisch für gleiche
  Modalität); robuste Intensitätsskalierung, Mehrstufen-Abtastung (8 → 4 → 2 mm) mit Jitter, Powell-Optimierung
  mit Brent-Liniensuche; **rigide (6) oder affin (12 Parameter)**; optionale Grobsuche (Schwerpunkt + Rotationsraster
  ±30°) für Daten aus verschiedenen Untersuchungen. Läuft im Web Worker mit Fortschritt und Abbruch; Ergebnis
  übernehmen oder verwerfen.
- **Manuelle Feinkorrektur** (Verschiebung/Drehung), Transformationsmatrix als JSON speichern und laden.

### Analyse
- Anzahl Bildpunkte, Minimum, Mittelwert, Median, Maximum, Histogramm (Bins, log. Skala, ohne Nullwerte).
- Für PET (Einheit BQML) wahlweise in **SUV** (Körpergewicht; zerfallskorrigiert auf Serienstart bzw. Injektion).

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
- `src/resample/` – Interpolation (NN/trilinear/B-Spline), Resampling in Zielraster, eigene Matrix-/Voxelgrößen
- `src/dicom/` – DICOM-Parsing (Rohdaten), Pixel-Dekodierung inkl. JPEG Lossless
- `src/recon/` – Sinogramm, FFT/Rampenfilter, FBP, OSEM
- `src/viewer/` – Volume-Modell, Volumen-Loader, Ebenen-Abtastung im Weltkoordinatensystem, Layer-Komposition, Viewer, MIP
- `src/dataset/` – Datenmodell geladener Volumen (Herkunft, Bearbeitungen, Header-Änderungen) und Hilfsfunktionen
- `src/analysis/` – Statistik, Histogramm, SUV
- `src/edit/` – Bearbeitungsoperationen, VOI, Filter, Geometrie-Operationen, Worker-Runner
- `src/header/` – Tag-Wörterbuch, Header-Modell, Validierung
- `src/export/` – header-erhaltender DICOM-Rewriter, Vorlagen-Writer, Anonymisierung, Pixel-Kodierung, NIfTI, ZIP
- `src/workers/` – Worker für Rekonstruktion, Bearbeitung, Coregistrierung und Resampling
- `src/ui/`, `src/components/` – Oberfläche (Shell, Panels)
