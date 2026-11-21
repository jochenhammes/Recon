# CT-Segmentierungsmodelle im Vergleich

Reproduzierbarer Vergleich der CT-Modelle von Recon Studio (`public/models/*`) mit Expertensegmentierungen.
Gerechnet wird exakt die Pipeline der App: RAS-Resampling, Normalisierung, Sliding Window, Top-k-Ausgabe, mit
onnxruntime-web (CPU/WASM) in Node. Die Vorhersagen werden mit nächstem Nachbarn auf das Raster der Referenz
übertragen.

## Referenzdaten (nicht im Repository)

**AMOS 2022** (Ji et al., NeurIPS 2022; CC BY 4.0, Zenodo 7262581): 15 Bauchorgane, von Experten annotiert, nicht im
Training von TotalSegmentator, MONAI oder MOOSE. Einzelne Fälle lassen sich per HTTP-Range aus dem 24-GB-Zip holen:

```bash
pip install remotezip
python -I tools/ctseg-benchmark/fetch_amos.py /pfad/amos 10        # 10 CT-Fälle aus dem Validierungsteil
```

## Lauf

```bash
DATA=/pfad/amos/amos22 N=10 OUT=/pfad/ergebnis \
MODELS=totalseg-total-3mm,totalseg-organs-1.5mm \
npx vitest run --config tools/ctseg-benchmark/vitest.config.ts
```

Ergebnis: `OUT/results.csv` (Fall × Modell × Struktur: Dice, HD95, NSD bei 2 mm, Volumen) und `OUT/report.md`
(Mittelwert ± SD je Struktur, Laufzeit).

Strukturen werden über die Namen zugeordnet (`src/segmentation/labelMap.ts`, z. B. „right kidney“ → kidney_right,
„postcava“ → inferior_vena_cava, Herzteile → heart). „prostate/uterus“ hat kein Gegenstück und wird übersprungen.

## Prüfung eines Exports gegen das Original

`monai_reference.py` rechnet einen Fall mit der originalen MONAI-Pipeline (PyTorch, Bundle-Transformationen) und gibt
Dice gegen die Referenz aus. Damit lässt sich unterscheiden, ob eine Abweichung vom ONNX-Export oder vom Modell selbst kommt.

```bash
python -I monai_reference.py <bundle> <bild.nii.gz> <label.nii.gz> <ausgabe.npz>
```
