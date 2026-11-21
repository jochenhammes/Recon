# Ergebnisse: CT-Segmentierungsmodelle auf AMOS (Stand November 2026)

Referenz: AMOS 2022, Validierungsteil, CT-Fälle mit Expertensegmentierung (CC BY 4.0, Zenodo 7262581). Kein Modell
wurde auf AMOS trainiert. Gerechnet mit der Pipeline der App (`benchmark.test.ts`); Vorhersagen per nächstem Nachbarn
auf das Raster der Referenz übertragen. Dice, NSD (Toleranz 2 mm), HD95 je Organ, Mittelwert ± SD über die Fälle.

## Zusammenfassung

| Modell | Lizenz | Größe | Strukturen | Dice (AMOS-Organe) | Laufzeit* |
|---|---|---|---|---|---|
| TotalSegmentator total 3 mm (Standard) | Apache-2.0 | 66 MB | 117 | 0,80 (10 Fälle) | 149 s WASM / 66 s nativ |
| MONAI SegResNet 3 mm | Apache-2.0 | 75 MB | 104 | 0,53 (10 Fälle) – **entfernt** | 109 s WASM |
| TotalSegmentator Organe 1,5 mm | Apache-2.0 | 125 MB | 24 | 0,86** (3 Fälle) | 191 s nativ |
| MOOSE 3 clin_ct_organs 1,5 mm | CC BY 4.0 | 122 MB | 19 | 0,85** (3 Fälle) | 183 s nativ |

\* CPU, 4 Threads; „WASM“ = onnxruntime-web wie im Browser ohne WebGPU, „nativ“ = onnxruntime-node.
\*\* Mittel über die 10 Organe, die alle Modelle haben; TotalSegmentator 3 mm auf denselben 3 Fällen: 0,83.

- **MONAI SegResNet** ist unzuverlässig: in 2 von 10 Fällen fast vollständiges Versagen (8 bzw. 13 von 14 Organen
  Dice < 0,1), in 3 weiteren fehlen einzelne Organe (z. B. linke Niere und Milz in amos_0008). Die originale
  MONAI-Pipeline (`monai_reference.py`) liefert dasselbe – Modelleigenschaft, kein Exportfehler.
- **1,5-mm-Modelle** sind etwas genauer als TotalSegmentator 3 mm, vor allem bei kleinen Organen (Nebennieren
  +0,08 Dice, Pankreas +0,03); bei Leber, Nieren, Milz +0,01–0,02. Dafür etwa 3× Rechenzeit und weniger Strukturen
  (keine Gefäße, Knochen, Muskeln).
- **Aufgenommen:** TotalSegmentator 3 mm (Standard), TotalSegmentator Organe 1,5 mm und MOOSE 1,5 mm. MOOSE wurde auf
  Low-Dose-CTs aus PET/CT trainiert – dem typischen Material von Recon Studio, das AMOS (diagnostische Bauch-CTs) nicht
  abbildet; mit 3 Fällen ist der Unterschied zu TotalSegmentator 1,5 mm nicht belastbar.
- **CADS** (167 Strukturen) nicht exportiert: 9 große ResEnc-L-Teilmodelle, Gewichte unter eigener Lizenz mit
  teils nicht-kommerziellen Anteilen.

## TotalSegmentator 3 mm vs. MONAI SegResNet (10 Fälle, onnxruntime-web)

### Dice per structure

| Structure | totalseg-total-3mm | monai-segresnet-3mm |
|---|---|---|
| adrenal_gland_left | 0.638 ± 0.092 | 0.288 ± 0.299 |
| adrenal_gland_right | 0.579 ± 0.139 | 0.431 ± 0.234 |
| aorta | 0.891 ± 0.019 | 0.607 ± 0.313 |
| duodenum | 0.619 ± 0.111 | 0.439 ± 0.231 |
| esophagus | 0.708 ± 0.145 | 0.415 ± 0.354 |
| gallbladder | 0.742 ± 0.186 | 0.442 ± 0.296 |
| inferior_vena_cava | 0.799 ± 0.070 | 0.578 ± 0.284 |
| kidney_left | 0.925 ± 0.024 | 0.565 ± 0.376 |
| kidney_right | 0.924 ± 0.026 | 0.719 ± 0.303 |
| liver | 0.955 ± 0.006 | 0.739 ± 0.371 |
| pancreas | 0.776 ± 0.088 | 0.475 ± 0.281 |
| spleen | 0.934 ± 0.013 | 0.552 ± 0.382 |
| stomach | 0.869 ± 0.079 | 0.525 ± 0.333 |
| urinary_bladder | 0.773 ± 0.156 | 0.698 ± 0.161 |

### NSD (2 mm) per structure

| Structure | totalseg-total-3mm | monai-segresnet-3mm |
|---|---|---|
| adrenal_gland_left | 0.820 ± 0.100 | 0.382 ± 0.384 |
| adrenal_gland_right | 0.771 ± 0.159 | 0.561 ± 0.300 |
| aorta | 0.909 ± 0.048 | 0.591 ± 0.303 |
| duodenum | 0.564 ± 0.119 | 0.400 ± 0.213 |
| esophagus | 0.789 ± 0.137 | 0.453 ± 0.372 |
| gallbladder | 0.727 ± 0.197 | 0.385 ± 0.259 |
| inferior_vena_cava | 0.764 ± 0.067 | 0.529 ± 0.276 |
| kidney_left | 0.914 ± 0.069 | 0.501 ± 0.361 |
| kidney_right | 0.914 ± 0.084 | 0.653 ± 0.285 |
| liver | 0.861 ± 0.029 | 0.588 ± 0.312 |
| pancreas | 0.755 ± 0.099 | 0.410 ± 0.259 |
| spleen | 0.897 ± 0.056 | 0.453 ± 0.370 |
| stomach | 0.765 ± 0.109 | 0.388 ± 0.297 |
| urinary_bladder | 0.635 ± 0.155 | 0.481 ± 0.184 |

### HD95 (mm) per structure

| Structure | totalseg-total-3mm | monai-segresnet-3mm |
|---|---|---|
| adrenal_gland_left | 5.9 ± 3.5 | 12.1 ± 9.1 |
| adrenal_gland_right | 7.0 ± 4.7 | 6.7 ± 2.7 |
| aorta | 13.0 ± 19.7 | 43.9 ± 60.6 |
| duodenum | 13.0 ± 4.9 | 23.0 ± 12.0 |
| esophagus | 8.1 ± 7.5 | 14.7 ± 15.7 |
| gallbladder | 10.9 ± 7.8 | 14.8 ± 9.1 |
| inferior_vena_cava | 6.7 ± 3.0 | 33.3 ± 53.0 |
| kidney_left | 2.7 ± 1.3 | 26.5 ± 31.5 |
| kidney_right | 2.8 ± 1.4 | 11.7 ± 18.9 |
| liver | 4.3 ± 0.6 | 43.9 ± 70.0 |
| pancreas | 6.4 ± 3.4 | 38.2 ± 42.9 |
| spleen | 3.1 ± 1.2 | 37.9 ± 62.0 |
| stomach | 13.3 ± 17.8 | 49.3 ± 64.6 |
| urinary_bladder | 16.7 ± 25.9 | 16.9 ± 18.9 |

## 3 mm vs. 1,5 mm (3 Fälle: amos_0008, amos_0013, amos_0018; onnxruntime-node)

### Dice per structure

| Structure | totalseg-total-3mm | totalseg-organs-1.5mm | moose-organs-1.5mm |
|---|---|---|---|
| adrenal_gland_left | 0.635 ± 0.013 | 0.722 ± 0.033 | 0.711 ± 0.027 |
| adrenal_gland_right | 0.575 ± 0.062 | 0.661 ± 0.043 | 0.660 ± 0.053 |
| aorta | 0.887 ± 0.026 | – | – |
| duodenum | 0.599 ± 0.031 | 0.646 ± 0.014 | – |
| esophagus | 0.605 ± 0.193 | 0.678 ± 0.158 | – |
| gallbladder | 0.824 ± 0.047 | 0.844 ± 0.055 | 0.825 ± 0.049 |
| inferior_vena_cava | 0.806 ± 0.032 | – | – |
| kidney_left | 0.925 ± 0.012 | 0.940 ± 0.013 | 0.936 ± 0.012 |
| kidney_right | 0.923 ± 0.006 | 0.942 ± 0.008 | 0.939 ± 0.007 |
| liver | 0.955 ± 0.004 | 0.961 ± 0.004 | 0.963 ± 0.004 |
| pancreas | 0.793 ± 0.051 | 0.830 ± 0.044 | 0.816 ± 0.054 |
| spleen | 0.925 ± 0.016 | 0.937 ± 0.019 | 0.934 ± 0.019 |
| stomach | 0.882 ± 0.021 | 0.892 ± 0.015 | 0.848 ± 0.089 |
| urinary_bladder | 0.879 ± 0.018 | 0.870 ± 0.021 | 0.870 ± 0.078 |

### NSD (2 mm) per structure

| Structure | totalseg-total-3mm | totalseg-organs-1.5mm | moose-organs-1.5mm |
|---|---|---|---|
| adrenal_gland_left | 0.797 ± 0.036 | 0.886 ± 0.035 | 0.883 ± 0.018 |
| adrenal_gland_right | 0.775 ± 0.088 | 0.831 ± 0.076 | 0.831 ± 0.087 |
| aorta | 0.913 ± 0.068 | – | – |
| duodenum | 0.542 ± 0.014 | 0.595 ± 0.019 | – |
| esophagus | 0.715 ± 0.163 | 0.797 ± 0.097 | – |
| gallbladder | 0.812 ± 0.043 | 0.857 ± 0.076 | 0.810 ± 0.067 |
| inferior_vena_cava | 0.779 ± 0.015 | – | – |
| kidney_left | 0.929 ± 0.028 | 0.935 ± 0.024 | 0.934 ± 0.019 |
| kidney_right | 0.927 ± 0.013 | 0.940 ± 0.023 | 0.938 ± 0.019 |
| liver | 0.871 ± 0.009 | 0.885 ± 0.013 | 0.904 ± 0.002 |
| pancreas | 0.787 ± 0.017 | 0.846 ± 0.028 | 0.821 ± 0.039 |
| spleen | 0.882 ± 0.056 | 0.898 ± 0.056 | 0.907 ± 0.049 |
| stomach | 0.763 ± 0.102 | 0.801 ± 0.085 | 0.784 ± 0.130 |
| urinary_bladder | 0.742 ± 0.061 | 0.705 ± 0.063 | 0.798 ± 0.147 |

### HD95 (mm) per structure

| Structure | totalseg-total-3mm | totalseg-organs-1.5mm | moose-organs-1.5mm |
|---|---|---|---|
| adrenal_gland_left | 6.8 ± 2.7 | 5.6 ± 3.5 | 5.5 ± 3.1 |
| adrenal_gland_right | 6.9 ± 2.3 | 4.7 ± 1.7 | 4.6 ± 1.9 |
| aorta | 21.2 ± 27.2 | – | – |
| duodenum | 15.0 ± 5.4 | 14.5 ± 5.7 | – |
| esophagus | 14.2 ± 9.7 | 10.1 ± 4.2 | – |
| gallbladder | 9.7 ± 6.9 | 8.6 ± 8.3 | 9.9 ± 8.1 |
| inferior_vena_cava | 5.6 ± 0.7 | – | – |
| kidney_left | 2.5 ± 0.6 | 2.7 ± 0.9 | 2.5 ± 0.5 |
| kidney_right | 2.8 ± 0.4 | 2.4 ± 0.8 | 2.4 ± 0.5 |
| liver | 4.5 ± 0.2 | 4.2 ± 0.7 | 3.4 ± 0.2 |
| pancreas | 5.5 ± 0.5 | 5.1 ± 0.3 | 5.3 ± 0.3 |
| spleen | 3.8 ± 1.4 | 3.7 ± 1.4 | 3.3 ± 1.4 |
| stomach | 5.3 ± 0.4 | 6.8 ± 2.0 | 13.8 ± 8.8 |
| urinary_bladder | 4.8 ± 0.3 | 5.2 ± 0.2 | 6.0 ± 3.9 |
