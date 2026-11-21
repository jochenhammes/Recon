# CT-Segmentierung: Tests und Modellauswahl

Stand: November 2026, Branch `ctseg-modelle`. Werkzeuge und Rohtabellen: `tools/ctseg-benchmark/` (`RESULTS.md`),
Export-Skripte: `tools/ctseg-onnx/`.

## 1. Fragestellung

Gibt es neben TotalSegmentator „total“ 3 mm weitere frei verfügbare CT-Segmentierungsmodelle, die sich im Browser
(ONNX Runtime Web, WebGPU/CPU) betreiben lassen, und wie schneiden sie im direkten Vergleich ab?

Vorgaben:
- auch nicht-kommerzielle Lizenzen zulässig (mit Hinweis in der App);
- Vergleich auf einem öffentlichen Referenzdatensatz;
- Ergebnis: Modellauswahl in der App plus Benchmark-Werkzeug.

## 2. Kandidaten

| Modell | Architektur | Strukturen | Lizenz der Gewichte | Ergebnis der Prüfung |
|---|---|---|---|---|
| TotalSegmentator „total“ 3 mm (Dataset297) | nnU-Net | 117 | Apache-2.0 | bisheriger Standard |
| TotalSegmentator Organe 1,5 mm (Dataset291) | nnU-Net | 24 | Apache-2.0 | exportiert, 125 MB |
| MOOSE 3 clin_ct_organs 1,5 mm | nnU-Net (fold „all“) | 19 | CC BY 4.0 | exportiert, 122 MB |
| MONAI wholeBody_ct_segmentation (SegResNet, 3 mm) | SegResNet | 104 (TotalSeg-v1-Liste) | Apache-2.0 | exportiert, 75 MB |
| CADS | nnU-Net ResEnc-L, 9 Teilmodelle | 167 | eigene Lizenz, teils nicht-kommerziell | nicht exportiert: Größe (9 große Teilmodelle), Lizenz |
| VISTA3D (NVIDIA) | Foundation-Modell | 127 | NVIDIA-Lizenz | ausgeschieden: Größe, Lizenz |
| STU-Net | nnU-Net-Variante | 104 | unklar | ausgeschieden: Lizenz ungeklärt |

## 3. Export und Prüfung der ONNX-Modelle

Anpassungen für ONNX Runtime Web (mathematisch identisch zum Original):
- `ConvTranspose3d` als 1×1×1-Faltung plus 3D-Pixel-Shuffle; auch anisotrope Strides, z. B. bei MOOSE mit Patch 224×96×96.
- Bei MONAI trilineares ×2-Upsampling als explizite Interpolation.
- Ausgabekopf mit den 3 wahrscheinlichsten Klassen und deren Wahrscheinlichkeit je Voxel statt aller Logits.
- Teile ≤ 90 MB für das statische Hosting.

Prüfung je Export: dasselbe Zufalls-Patch durch PyTorch-Original und ONNX.

| Modell | Übereinstimmung Top-1-Klasse (ONNX vs. PyTorch) | max. Abweichung Top-1-Wahrscheinlichkeit |
|---|---|---|
| MONAI SegResNet 3 mm | 1,0 | 3,7·10⁻⁶ |
| TotalSegmentator Organe 1,5 mm | 1,0 | 3,1·10⁻⁶ |
| MOOSE clin_ct_organs 1,5 mm | 1,0 | 2,1·10⁻⁶ |

Achsenkonvention: TotalSegmentator (nnU-Net NibabelIO) und MOOSE (SimpleITK, RAS) erwarten beide Arrays in
(z, y, x)-Reihenfolge eines RAS-Gitters – das liefert die App. MONAI arbeitet in (x, y, z); die Patches werden dafür
im Worker transponiert.

## 4. Benchmark auf Expertendaten (AMOS 2022)

### Methode
- **Daten:** AMOS 2022, Validierungsteil, CT-Fälle mit Expertensegmentierung (Ji et al., NeurIPS 2022; CC BY 4.0,
  Zenodo 7262581).
  - Kein Modell wurde auf AMOS trainiert.
  - Einzelne Fälle werden per HTTP-Range aus dem 24-GB-Archiv geladen; die Daten liegen nicht im Repository.
- **Pipeline:** exakt die der App (RAS-Resampling, Normalisierung, Sliding Window mit Gauß-Gewichtung, Top-k-Kopf).
  - Gerechnet mit onnxruntime-web (WASM, wie im Browser) bzw. onnxruntime-node (gleiches Modell, native CPU) für die
    langsamen 1,5-mm-Modelle.
  - Vorhersagen werden per nächstem Nachbarn auf das Raster der Referenz übertragen.
- **Zuordnung der Strukturen** über kanonische Namen (`src/segmentation/labelMap.ts`), z. B. „right kidney“ →
  kidney_right, „postcava“ → inferior_vena_cava, Herzteile → heart. „prostate/uterus“ hat kein Gegenstück.
- **Metriken je Organ:**
  - Dice;
  - NSD (normalisierter Oberflächen-Dice, Toleranz 2 mm);
  - HD95 (95.-Perzentil des Oberflächenabstands);
  - Volumen;
  - Laufzeit.

### 4.1 TotalSegmentator 3 mm vs. MONAI SegResNet 3 mm (10 Fälle, onnxruntime-web, 4 Threads)

| | TotalSegmentator 3 mm | MONAI SegResNet 3 mm |
|---|---|---|
| Mittlerer Dice (14 Organe) | **0,80 ± 0,16** | 0,53 ± 0,33 |
| Mittlerer NSD | **0,79** | 0,48 |
| Median HD95 | **5,0 mm** | 10,1 mm |
| Laufzeit je Fall (CPU) | 149 s | 109 s |

| Organ | TotalSegmentator 3 mm | MONAI 3 mm |
|---|---|---|
| Leber | 0,955 ± 0,006 | 0,739 ± 0,371 |
| Milz | 0,934 ± 0,013 | 0,552 ± 0,382 |
| Niere links | 0,925 ± 0,024 | 0,565 ± 0,376 |
| Niere rechts | 0,924 ± 0,026 | 0,719 ± 0,303 |
| Aorta | 0,891 ± 0,019 | 0,607 ± 0,313 |
| Magen | 0,869 ± 0,079 | 0,525 ± 0,333 |
| Pankreas | 0,776 ± 0,088 | 0,475 ± 0,281 |
| Harnblase | 0,773 ± 0,156 | 0,698 ± 0,161 |
| Nebennieren li./re. | 0,64 / 0,58 | 0,29 / 0,43 |

**MONAI je Fall:** mittlerer Dice

| Fall | 0008 | 0013 | 0018 | 0022 | 0029 | 0032 | 0034 | 0040 | 0041 | 0051 |
|---|---|---|---|---|---|---|---|---|---|---|
| MONAI | 0,45 | 0,54 | 0,81 | 0,78 | 0,85 | 0,68 | 0,10 | 0,04 | 0,45 | 0,65 |
| TotalSegmentator | 0,81 | 0,77 | 0,82 | 0,83 | 0,87 | 0,88 | 0,73 | 0,78 | 0,70 | 0,75 |

- **Totalausfälle:** In 2 Fällen versagt MONAI fast vollständig (8 bzw. 13 von 14 Organen mit Dice < 0,1).
- **Teilausfälle:** In 3 weiteren Fällen fehlen einzelne Organe.
- **Beispiel amos_0008:** MONAI erkennt linke Niere und Milz nicht, obwohl beide vorhanden und anatomisch normal sind (kein
  Zustand nach OP; visuell geprüft); rechts werden Leber und Niere erkannt.
- **Gegenprobe:** Die **originale MONAI-Pipeline** (PyTorch, Bundle-Transformationen;
  `tools/ctseg-benchmark/monai_reference.py`) liefert dasselbe (linke Niere 0,0, Milz 0,007). Das ist eine
  Eigenschaft des Modells, kein Exportfehler.

### 4.2 3 mm vs. 1,5 mm (3 Fälle: amos_0008, amos_0013, amos_0018; onnxruntime-node, 4 Threads)

| | TotalSegmentator 3 mm | TotalSegmentator Organe 1,5 mm | MOOSE 1,5 mm |
|---|---|---|---|
| Mittlerer Dice, 10 gemeinsame Organe | 0,83 | **0,86** | 0,85 |
| Mittlerer NSD (alle bewerteten Organe) | 0,80 | 0,83 | **0,86** |
| Median HD95 | 5,0 mm | 5,0 mm | **3,9 mm** |
| Laufzeit je Fall (native CPU) | 66 s | 191 s | 183 s |
| Strukturen im Modell | 117 | 24 | 19 |

| Organ | TS 3 mm | TS 1,5 mm | MOOSE 1,5 mm |
|---|---|---|---|
| Leber | 0,955 | 0,961 | 0,963 |
| Niere links | 0,925 | 0,940 | 0,936 |
| Niere rechts | 0,923 | 0,942 | 0,939 |
| Milz | 0,925 | 0,937 | 0,934 |
| Pankreas | 0,793 | 0,830 | 0,816 |
| Gallenblase | 0,824 | 0,844 | 0,825 |
| Nebenniere links | 0,635 | 0,722 | 0,711 |
| Nebenniere rechts | 0,575 | 0,661 | 0,660 |

Die 1,5-mm-Modelle sind etwas genauer, vor allem bei kleinen Organen (Nebennieren +0,08, Pankreas +0,03), bei Leber,
Nieren und Milz um 0,01–0,02. Gefäße, Knochen und Muskeln fehlen ihnen.

## 5. Prüfungen in der Browser-Laufzeit

Öffentliches TotalSegmentator-Beispiel-CT; Referenz ist die Segmentierung der Python-Pipeline von TotalSegmentator.
Gerechnet mit onnxruntime-web (CPU/WASM), wie in der App.

| Modell | Raster | Kacheln / Laufzeit | Mittlerer Dice zur Referenz |
|---|---|---|---|
| TotalSegmentator 3 mm | 3 mm | 1 / 16 s | 0,999 (61 Strukturen) |
| MONAI SegResNet 3 mm | 3 mm | 8 / 79 s | 0,898 (57 Strukturen) |
| TotalSegmentator Organe 1,5 mm | 1,5 mm | 12 / 211 s | 0,916 (17 Strukturen) |
| MOOSE Organe 1,5 mm | 1,5 mm | 9 / 195 s | 0,902 (13 Strukturen) |

TotalSegmentator 3 mm reproduziert die Python-Referenz (0,999). Bei den übrigen Modellen misst der Wert die
Übereinstimmung zweier unabhängiger Modelle, nicht die Genauigkeit.

## 6. Tests der App im Browser

**Chromium**, headless, CPU-Modus, Beispiel-CT:
- **Modellauswahl:** zeigt alle Modelle; Hinweistexte für die 1,5-mm-Modelle stimmen.
- **Segmentierung 3 mm:** 22 s, 61 Strukturen, 9,4 l.
- **Karte „Modellvergleich“:**
  - Mit der 3-mm-Organkarte als Referenz: 3 mm Dice 1,000 (erwartet), 1,5 mm Dice 0,916 über 17 gemeinsame Strukturen.
  - Strukturen, die einem Modell fehlen, stehen als „–“.
  - Vergrößerte Tabelle und CSV-Export (Dezimalkomma) funktionieren.
  - Korrigiert: abgeschnittene Spalten in der Seitenleiste (jetzt „3 mm“/„1,5 mm“ bzw. Kurznamen); „9.4 l“ → „9,4 l“.

**Rückmeldungen von echten Rechnern:**
- **Ubuntu, Chromium:** 1,5-mm-Modell auf der CPU mit allen Kernen unter Volllast.
- **MacBook M4, Safari 27 (macOS 27):** CPU lief zunächst nur mit einem Thread.
  - Ursache: `coi-serviceworker` setzte in Safari COEP „credentialless“, das Safari nicht unterstützt. Die Seite war
    nicht cross-origin-isoliert und hatte deshalb keinen SharedArrayBuffer.
  - Behoben: COEP „require-corp“ für alle Browser (die App lädt nur eigene Dateien). Zusätzlich senden `npm run dev` und
    `npm run preview` die Header direkt.
  - Danach rechnet Safari mit allen Kernen.
- **Mac, Safari und Chrome:** WebGPU läuft, ist aber langsamer als die CPU mit allen Kernen.
  - Grund: ONNX Runtime hat für 3D-Faltungen auf WebGPU nur einen einfachen Kernel; optimiert sind nur 2D-Faltungen.
  - Konsequenz: „Automatisch“ rechnet auf dem Mac auf der CPU (wie bisher in Firefox); WebGPU bleibt manuell wählbar.

**Speicher:**
- Die Segmentierung braucht etwa 25 Byte je Voxel des Modellrasters (CT, Top-k-Akkumulator, Labels).
- Ein Ganzkörper-CT bei 1,5 mm (75–140 Mio. Voxel) bräuchte 2–3,5 GB und übersteigt den Browser.
- Deshalb prüft die App vorher und bricht oberhalb von 1,6 GB mit einer Meldung ab (Alternative: 3-mm-Modell oder
  zuschneiden). Rumpf- und Bauch-CTs passen.

**Automatische Tests:**
- Unit-Tests für Normalisierungsvarianten, Patch-Transposition, Label-Harmonisierung, Dice, exakte euklidische
  Distanztransformation, HD95/NSD und die Speicherprüfung.
- Insgesamt 237 Tests grün; Typprüfung und Lint ohne Befund.

## 7. Modellauswahl und Begründung

| Modell | Entscheidung | Begründung |
|---|---|---|
| TotalSegmentator „total“ 3 mm | **Standard** | Bester Kompromiss: 117 Strukturen (auch Knochen, Gefäße, Muskeln für Ausschluss und Knochen/Weichteil-Zuordnung), zuverlässig in allen 10 AMOS-Fällen (kein Ausfall), schnell, passt auch für Ganzkörper-CTs in den Speicher. |
| TotalSegmentator Organe 1,5 mm | **aufgenommen** | Etwas genauer, besonders bei kleinen Organen. Sinnvoll für Organdosimetrie und Rumpf-/Bauch-CTs. Apache-2.0. |
| MOOSE Organe 1,5 mm | **aufgenommen** | Gleichauf mit TotalSegmentator 1,5 mm (Unterschied bei 3 Fällen nicht belastbar). Trainiert auf rund 1.700 Low-Dose-CTs aus PET/CT (ENHANCE-PET) – dem typischen Material von Recon Studio, das AMOS (diagnostische Bauch-CTs) nicht abbildet. Enthält Gehirn und Schilddrüsenlappen. CC BY 4.0 (kommerzielle Nutzung mit Namensnennung erlaubt). |
| MONAI SegResNet 3 mm | **entfernt** | Unzuverlässig: mittlerer Dice 0,53, zwei Totalausfälle in 10 Fällen, auch mit der Original-Pipeline. Export-Skript und Prüfskript bleiben zum Nachvollziehen in `tools/`. |
| CADS | nicht aufgenommen | 9 große Teilmodelle (nicht browsertauglich), Lizenz teils nicht-kommerziell. |
| VISTA3D, STU-Net | nicht aufgenommen | Größe bzw. ungeklärte Lizenz. |

Kosten der Auswahl: +247 MB im Repository. Im Browser wird ein Modell erst bei Auswahl geladen und dann im
Browser-Cache gespeichert.

## 8. Grenzen und offene Punkte

- **Stichprobe:** Der 1,5-mm-Vergleich beruht auf 3 Fällen; die Unterschiede zwischen TotalSegmentator 1,5 mm und MOOSE
  sind nicht belastbar.
- **Datensatz:** AMOS enthält diagnostische Bauch-CTs. Ein Vergleich auf Low-Dose-CTs aus PET/CT (dem Einsatzgebiet,
  für das MOOSE spricht) steht aus; dafür wären öffentliche PET/CT-CTs mit Organlabels nötig.
- **WebGPU:** auf Rechnern mit dedizierter Grafikkarte (Windows/Linux) nicht systematisch gemessen. Ein Export mit
  2D-Faltungen (`--2d`) wäre auf WebGPU schneller, braucht aber etwa dreimal so viel Grafikspeicher (frühere Abstürze
  in Safari) – nicht umgesetzt.
- **Speichergrenze:** Die Grenze von 1,6 GB ist geschätzt, nicht je Browser gemessen. Ein Zuschnitt auf den Körper vor der
  1,5-mm-Segmentierung würde größere CTs erlauben.
- **Halbe Genauigkeit:** fp16-Modelle (kleiner, auf Apple-GPUs schneller) nicht untersucht.
