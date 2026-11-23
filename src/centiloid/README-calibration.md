# Centiloid-Kalibrierung der Recon-Studio-Pipeline

## Pipeline

Automatische MRT-Pipeline der App (Panel *MNI* → *Centiloid*):

1. PET → T1 rigide (6 Parameter, normalisierte Mutual Information, Grobsuche, 8 → 4 → 2 mm).
2. T1 → MNI152 2009c (T1, 2 mm) **affin** (12 Parameter): Ganzkopf mit NMI und Grobsuche, dann Verfeinerung mit
   Kreuzkorrelation innerhalb der Hirnmaske der Vorlage.
3. PET über beide Transformationen trilinear auf das Vorlagenraster.
4. Mittelwerte in den GAAIN-Standard-VOIs (`Centiloid_Std_VOI.zip`, 2 mm) → SUVR = Kortex / Referenz.

Die nichtlineare Verformung (DCT, SPM-artig) wird für Centiloid **nicht** verwendet: Sie stimmte schlechter mit der
Standardmethode überein (siehe unten).

## Daten

- GAAIN-Level-1-Daten (Klunk et al., Alzheimers Dement 2015;11:1–15): 34 junge Kontrollen (YC-0), 45 Alzheimer-Patienten
  (AD-100), T1-MRT und [¹¹C]PiB 50–70 min (NIfTI, Big-Endian).
- GAAIN Florbetaben-Projekt (Rowe et al., Eur J Nucl Med Mol Imaging 2017;44:2053–2059): 35 Probanden (25 ältere,
  10 junge Kontrollen) mit T1-MRT, Florbetaben-PET (90–110 min) und PiB-PET (50–70 min) sowie den veröffentlichten SUVR-
  und Centiloid-Werten der Standardmethode.
- Die Daten werden nicht mitgeliefert (GAAIN-Nutzungsbedingungen).

## Vorgehen (Klunk 2015)

1. **Replikation von Level 1 (§ 2.2.1):** Die App-Pipeline auf YC-0 und AD-100. Die Gruppenmittel der App-SUVR müssen
   innerhalb von ±2 % der Standardwerte liegen (1,009 bzw. 2,076, ganzes Kleinhirn).
   - Ergebnis: YC-0 1,031 (+2,2 %), AD-100 2,068 (−0,4 %).
   - Das Kriterium ist knapp verfehlt. Die affine Normalisierung auf die MNI152-2009c-Vorlage ist eben nicht die
     SPM8-Standardmethode.
   - Die App wird deshalb als **nicht-standardisierte Methode** kalibriert.
2. **Kalibrierung (§ 2.2.3.2)** an den 35 Probanden des FBB-Projekts:
   - App-SUVR = m · Standard-PiB-SUVR + b (kleinste Quadrate);
   - PiB-Calc-SUVR = (SUVR − b)/m;
   - CL mit den Ankern der Standardpipeline, die die veröffentlichten Werte erzeugt hat. Die Anker sind aus den
     veröffentlichten SUVR/CL-Paaren exakt rekonstruiert: YC 1,0186, AD 2,0880.
3. **Prüfung:**
   - Leave-one-out gegen die veröffentlichten CL;
   - unabhängig auf den Level-1-Kohorten, die nicht zur Anpassung verwendet wurden.

## Ergebnisse (Referenz ganzes Kleinhirn)

| Tracer | m | b | R² (≥ 0,70 gefordert) | Gleichung der App | LOO-RMSE (max.) gegen veröffentlichte CL |
|---|---|---|---|---|---|
| PiB | 0,924 | 0,110 | 0,995 | CL = 101,20 · SUVR − 106,38 | 4,1 CL (11,1) |
| Florbetaben | 0,564 | 0,474 | 0,944 | CL = 165,66 · SUVR − 173,80 | 5,9 CL (15,5) |

- **Unabhängige Prüfung** auf den Level-1-Kohorten mit der PiB-Gleichung: YC-0 −2,0 ± 5,1 CL, AD-100 102,9 ± 19,4 CL.
  Standard: 0 ± 4,3 und 100 ± 17,9.
- **Relative Varianz** (SD der 10 jungen Kontrollen gegen PiB-Standard): PiB 1,31; Florbetaben 2,01. Die
  Standardmethode erreicht für Florbetaben 1,95.
- Die Kalibrierung bis November 2026 wurde per direkter Regression der veröffentlichten CL auf die App-SUVR hergeleitet:
  - PiB: 100,68 · SUVR − 105,61;
  - FBB: 164,06 · SUVR − 171,67.
  Sie lieferte praktisch dieselben Werte (Unterschied < 1,5 CL im Bereich 0–150 CL). Ersetzt wurde sie, weil sie nicht
  dem vorgeschriebenen Klunk-Verfahren folgte.
- Die nichtlineare Verformung (DCT) wird für Centiloid nicht verwendet: Gegen die Standardmethode war sie schlechter
  (FBB R² 0,92, Steigung 0,78, gegenüber affin R² 0,99, Steigung 0,93).
- Kontrolle: Die App im Browser liefert für einen Probanden denselben SUVR wie das Validierungsskript.

## Grenzen

- Die Kalibrierung gilt nur für die automatische MRT-Pipeline der App. Für extern (z. B. mit SPM) normalisierte Daten
  die Standardgleichungen (Rowe 2017, Klunk 2015) verwenden.
- PET-only (ohne MRT) ist nicht validiert.
- Kalibriert an 35 Probanden eines Scanners/Zentrums; die Werte sind nicht für die klinische Diagnostik zugelassen.

## Reproduktion

Repository Recon-Publication, Modul M1:
- `validation/m1-centiloid/centiloid.run.test.ts` wendet `runCentiloidPipeline` an (`src/centiloid/pipeline.ts`,
  gleiche Schritte wie die App).
- `validation/m1-centiloid/analyse.py` wertet aus.
- Die GAAIN-Daten müssen selbst heruntergeladen werden.
