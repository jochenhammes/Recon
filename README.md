# Recon Studio

Browserbasierte Werkbank für nuklearmedizinische Bilddaten: PET, SPECT, CT und MRT laden, fusionieren, registrieren,
segmentieren, quantifizieren, bearbeiten und exportieren – inklusive SPECT-Rekonstruktion aus Rohdaten.
Alles läuft im Browser; es gibt keinen Server, **die Daten verlassen den Rechner nicht**.

![Recon Studio: PET/CT mit CT-Organsegmentierung und Label-Analyse](docs/images/uebersicht.jpg)

**▶ App starten: [jochenhammes.github.io/Recon](https://jochenhammes.github.io/Recon/)** – läuft direkt im Browser, keine Installation.

**📖 Handbuch: [MANUAL.md](MANUAL.md)** – Bedienung aller Funktionen Schritt für Schritt mit Screenshots.

> Forschungswerkzeug – nicht für die Diagnostik zugelassen.

## Funktionen

| Bereich | Was die App kann |
|---|---|
| **Daten** | DICOM (Datei, Serie, Multi-Frame, JPEG Lossless; auch ohne Dateiendung) und NIfTI (`.nii`, `.nii.gz`); mehrere Serien in einem Upload werden getrennt geladen, unlesbare Dateien übersprungen; beliebig viele Datensätze mit Schlagwort; Labelbilder werden als Atlas erkannt |
| **SPECT-Rekonstruktion** | Projektionen (NM Multi-Frame, 1–2 Köpfe) mit FBP (Rampe, Shepp-Logan, Kosinus, Hamming, Hann, Butterworth) oder OSEM (Subsets, Iterationen) |
| **Ansicht** | Axial, sagittal, koronar und rotierende MIP in Patientenorientierung; beliebig viele Overlays mit eigener Farbtabelle, eigenem Fenster und eigener Deckkraft; Ebenen an/aus; WebGL2-Darstellung; Screenshot; Fusion als DICOM/NIfTI exportieren |
| **Registrierung** | Basis-Datensatz definiert den Raum; beliebige Datensätze darauf registrieren (rigide/affin; NMI, MI, Correlation Ratio, Kreuzkorrelation; Mehrstufen, Grobsuche); Ergebnis prüfen, übernehmen oder verwerfen; manuelle Feinkorrektur; Matrix als JSON |
| **Standardraum (MNI)** | MNI152-2009c-T1-, SPM-PET- und SPM-SPECT-Vorlage; affine und nichtlineare Normalisierung (SPM-artig); Übertragung coregistrierter Datensätze (z. B. PET über das T1); SPM/CAT12-`y_*.nii` importieren/exportieren |
| **Atlas & SUVR** | CerebrA (mitgeliefert), AAL3 (ZIP-Download) oder eigener Atlas; regionale Statistik, Referenzregion, SUVR-Tabelle und SUVR-Bild |
| **Centiloid** | Amyloid-PET mit GAAIN-Standard-VOIs (vom Nutzer geladen); MRT-Pipeline (affin) an den GAAIN-Referenzdaten kalibriert (Florbetaben und PiB, Kreuzvalidierung ca. 6 CL), Standardgleichungen für extern normalisierte Daten, eigene Gleichung; PET-only (nicht validiert) |
| **CT-Organsegmentierung** | TotalSegmentator „total“ (117 Strukturen, 3 mm) direkt im Browser (WebGPU oder CPU); Regionsliste mit Suche, Ein-/Ausblenden und Sprung zur Region |
| **Tumorlast** | Läsionen auf dem PET in SUV: SUV-Schwelle (z. B. 4,0 / 2,5 / PSMA 3), 41 % SUVmax, leberbasiert (PERCIST); TMTV/PSMA-TV, TLG/TL-PSMA, SUVmax/peak/mean, Dmax; automatischer Ausschluss physiologischer Anreicherung über CT-Organe; Knochen/Weichteil; Korrektur per Klick und Pinsel; CSV und Maske |
| **Analyse** | Übersicht aller Datensätze (Min, Mittel, Median, Max, SD, Varianz); Histogramm; SUV aus dem DICOM-Header; VOI auf allen Datensätzen; **Label-Analyse** (Statistik und Histogramm je Region einer Segmentierung oder eines Atlas) mit CSV-Export von Tabellen und Histogrammen je Label |
| **Bearbeiten** | Werteoperationen (Schwelle, Bereich, Begrenzen, linear), VOI (Kugel, Quader, Pinsel), Gauß-Glättung, Spiegeln, Drehen, Resampling; rückgängig |
| **DICOM-Header** | Alle Elemente durchsuchen, ändern, löschen, hinzufügen (mit VR-Prüfung) |
| **Export** | DICOM mit Original-Header (byte-genau erhalten) oder als neue Serie aus Vorlage, NIfTI mit Orientierung (Labelbilder mit Regionsnamen), Export in den Raum eines anderen Datensatzes, optionale Anonymisierung |

## Schnellstart

Die App läuft unter [GitHub Pages](https://jochenhammes.github.io/Recon/) (ein Push auf `main` veröffentlicht sie)
oder lokal:

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Unit-Tests (vitest)
npm run lint     # oxlint
npm run build    # Type-Check + Produktions-Build
```

Empfohlen: aktueller Chrome/Edge (WebGPU beschleunigt die CT-Segmentierung stark); Safari und Firefox funktionieren,
die CT-Segmentierung läuft dort ggf. auf der CPU.

## Aufbau des Codes

`src/core` Geometrie und Transformationen · `src/dicom`, `src/viewer/volumeLoader.ts` Laden · `src/recon` SPECT-Rekonstruktion ·
`src/viewer` Viewer und WebGL2 · `src/registration` Coregistrierung · `src/normalization` Standardraum ·
`src/atlas` Atlanten, Labelbilder, Regionalstatistik · `src/segmentation` CT-Segmentierung (ONNX Runtime Web) ·
`src/tumor` Läsionen und Tumorlast · `src/centiloid` Centiloid · `src/analysis` Statistik, SUV · `src/edit` Bearbeitung ·
`src/header` DICOM-Header · `src/export` DICOM/NIfTI/ZIP · `src/workers` Web Worker · `src/ui`, `src/components` Oberfläche ·
`tools/totalseg-onnx` Export des Segmentierungsmodells nach ONNX.

## Mitgelieferte Daten und Lizenzen

- `public/templates/`: MNI ICBM 152 Nonlinear Asymmetrical 2009c (Fonov et al. 2009/2011), © McConnell Brain Imaging
  Centre (`LICENSE-MNI152NLin2009cAsym.txt`); SPM12-PET- und -SPECT-Vorlage, GNU GPL v2+ (`LICENSE-SPM12-GPL.txt`).
- `public/atlases/`: CerebrA (Manera et al. 2020, Sci Data 7:237), CC0 1.0, auf das 2-mm-Raster der Vorlage übertragen.
- `public/models/totalseg-total-3mm/`: TotalSegmentator „total“ 3 mm (Wasserthal et al., Radiology: AI 2023; nnU-Net),
  Apache 2.0, nach ONNX exportiert (`tools/totalseg-onnx/export.py`), siehe `NOTICE.txt`.
- `public/coi-serviceworker.js`: coi-serviceworker 0.1.7 (G. Zuidhof), MIT (`LICENSE-coi-serviceworker.txt`), angepasst –
  aktiviert Cross-Origin-Isolation für mehrere CPU-Threads auf GitHub Pages.
- Nicht mitgeliefert: GAAIN-Centiloid-VOIs und -Daten (nur persönliche, nicht-kommerzielle Nutzung), AAL3 (Download von
  [gin.cnrs.fr](https://www.gin.cnrs.fr/en/tools/aal/)).
- Screenshots im Handbuch: synthetische Phantome, öffentliches Beispiel-CT von TotalSegmentator und aus der MNI-Vorlage
  abgeleitete Testbilder – keine Patientendaten.
