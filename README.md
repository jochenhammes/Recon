# Recon Studio

Browserbasierte Werkbank für nuklearmedizinische Bilddaten: SPECT-Rohdaten rekonstruieren, PET-, SPECT- und
CT-Volumen ansehen, analysieren, bearbeiten, mit CT fusionieren und als DICOM oder NIfTI exportieren.
Alles läuft clientseitig im Browser (Web Worker), es gibt keinen Server – die Daten verlassen den Rechner nicht.

## Funktionen

### Daten
- **Volumen laden**: DICOM (einzelne Datei, Multi-Frame oder ganze Serie; unkomprimiert oder JPEG Lossless;
  Explicit/Implicit VR) und NIfTI (`.nii`, `.nii.gz`). Patientenkoordinaten werden aus ImagePositionPatient/
  ImageOrientationPatient (inkl. Functional Groups und NM Detector Information) bzw. NIfTI-sform/qform gelesen,
  Serien nach Position entlang der Schichtnormale sortiert.
- **Zwei Datensätze**: funktionell (PET/SPECT) und anatomisch (CT/MR, wird über die Modalität erkannt). Ein Klick
  auf einen Datensatz-Chip in der Kopfzeile wählt aus, worauf sich Analyse, Bearbeitung, Header und Export beziehen.
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

### PET/SPECT-CT-Fusion
- Ausrichtung über die Patientenkoordinaten; Hinweis bei abweichendem Frame of Reference.
- PET/SPECT als farbiges, halbtransparentes Overlay über dem CT (Deckkraft, Sichtbarkeit je Layer).
- **Manuelle Feinregistrierung**: Verschiebung (mm) und Drehung (°) des PET/SPECT um die Volumenmitte.

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
- **Fusion**: PET/SPECT inkl. Bearbeitungen und Registrierung auf das CT-Raster resampelt, als DICOM-Serie
  (Frame of Reference des CT) oder NIfTI.
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

- `src/core/` – Patientengeometrie (LPS), Voxel↔Welt-Transformationen, DICOM-/NIfTI-Orientierung, Registrierung
- `src/dicom/` – DICOM-Parsing (Rohdaten), Pixel-Dekodierung inkl. JPEG Lossless
- `src/recon/` – Sinogramm, FFT/Rampenfilter, FBP, OSEM
- `src/viewer/` – Volume-Modell, Volumen-Loader, Ebenen-Abtastung im Weltkoordinatensystem, Layer-Komposition, Viewer, MIP
- `src/dataset/` – Datenmodell geladener Volumen (Herkunft, Bearbeitungen, Header-Änderungen) und Hilfsfunktionen
- `src/analysis/` – Statistik, Histogramm, SUV
- `src/edit/` – Bearbeitungsoperationen, VOI, Filter, Geometrie-Operationen, Worker-Runner
- `src/fusion/` – Resampling auf ein Zielraster
- `src/header/` – Tag-Wörterbuch, Header-Modell, Validierung
- `src/export/` – header-erhaltender DICOM-Rewriter, Vorlagen-Writer, Anonymisierung, Pixel-Kodierung, NIfTI, ZIP
- `src/workers/` – Worker für Rekonstruktion und Bearbeitung
- `src/ui/`, `src/components/` – Oberfläche (Shell, Panels)
