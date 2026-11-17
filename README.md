# SPECT-Rekonstruktion

Browserbasiertes Webtool zur Rekonstruktion von SPECT-Rohdaten (Einzelprojektionen von bis zu zwei
Detektorköpfen) aus DICOM-Dateien (Modality NM, Multi-Frame). Die gesamte Rekonstruktion läuft
clientseitig in Web Workern, es gibt keinen Server.

## Funktionen

- **Upload**: Drag & Drop oder Dateiauswahl für eine oder zwei Multi-Frame-DICOM-Dateien
  (ein Kopf pro Datei oder beide Köpfe in einer Datei via DetectorVector).
- **Rekonstruktion**:
  - Gefilterte Rückprojektion (FBP) mit wählbarem Filter (Ram-Lak, Shepp-Logan, Cosine, Hamming, Hann)
  - Iterative Rekonstruktion (OSEM) mit konfigurierbaren Subsets/Iterationen
  - Verteilt auf einen Pool von Web Workern, mit Fortschrittsanzeige und Abbruch-Möglichkeit
- **3D-Viewer**: Vier synchronisierte Ansichten — Axial, Sagittal, Coronal (drei senkrecht
  aufeinander stehende Schnittebenen) sowie eine rotierende MIP (Maximum Intensity Projection).
  Unterstützt Fadenkreuz-Navigation, Fenster/Level-Anpassung per Maus und Slice-Scrolling per Mausrad.
- **Analyse** (rekonstruierte und geladene Volumen): Anzahl Bildpunkte, Minimum, Mittelwert, Median,
  Maximum sowie Histogramm der Werteverteilung (Bins wählbar, log. Skala, Nullwerte ausblendbar).
- **Bearbeiten**: alle Werte ≥ Grenzwert im 3D-Datensatz auf einen festen Wert setzen, mit Vorschau der
  betroffenen Voxel, Rückgängig und Zurücksetzen aufs Original.
- **Export**: NIfTI oder DICOM. Bei hochgeladenen DICOM-Dateien bleibt der Header erhalten: alle Elemente
  (inkl. Patientendaten, Sequenzen, Private Tags) werden byte-genau übernommen; neu sind nur PixelData,
  SOP-/Series-Instance-UID, ImageType = DERIVED, optional SeriesDescription-Zusatz und
  DerivationDescription. Die Originalkodierung (Bit-Tiefe, Rescale Slope/Intercept) bleibt erhalten, solange
  die neuen Werte darstellbar sind; sonst wird neu skaliert und ein Hinweis angezeigt. Serien werden als ZIP
  mit den Original-Dateinamen exportiert, JPEG-Lossless-Originale unkomprimiert. Hochgeladene NIfTI-Dateien
  behalten ihren Original-Header (Datentyp float32).

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server
npm test         # Unit-Tests (FFT, FBP/OSEM, DICOM-Parser)
npm run build    # Type-Check + Produktions-Build
```

## Architektur

- `src/dicom/` – DICOM-Parsing (dicom-parser) inkl. Projektionswinkel-Geometrie
- `src/recon/` – Sinogramm, FFT/Rampenfilter, FBP, OSEM, gemeinsame Projektionsgeometrie
- `src/workers/` – Worker-Pool, der die Rekonstruktion über mehrere Threads parallelisiert
- `src/viewer/` – Volume-Modell (Slicing/MIP) und Canvas-basierter 4-Panel-Viewer
- `src/dataset/` – Datenmodell eines geladenen Volumens inkl. Herkunft (Original-DICOM/NIfTI) und Edit-Historie
- `src/analysis/` – Statistik und Histogramm
- `src/edit/` – Volumen-Operationen (Schwellwert-Ersetzung)
- `src/export/` – DICOM-/NIfTI-Writer, header-erhaltender DICOM-Rewriter, ZIP
- `src/components/` – Upload-, Rekonstruktions-, Analyse-, Edit- und Export-Panels
