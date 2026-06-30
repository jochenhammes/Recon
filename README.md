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
- `src/components/` – Upload- und Rekonstruktions-Steuerelemente
