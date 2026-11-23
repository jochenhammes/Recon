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
  (AD-100), T1-MRT und [¹¹C]PiB 50–70 min (NIfTI, Big-Endian). Die SUVR/CL je Proband stammen aus Supplemental Table A.
- GAAIN Florbetaben-Projekt (Rowe et al., Eur J Nucl Med Mol Imaging 2017;44:2053–2059): 35 Probanden (25 ältere,
  10 junge Kontrollen) mit T1-MRT, Florbetaben-PET (90–110 min) und PiB-PET (50–70 min) sowie den veröffentlichten SUVR-
  und Centiloid-Werten der Standardmethode.
- Die Daten werden nicht mitgeliefert (GAAIN-Nutzungsbedingungen).

## Vorgehen (Klunk 2015)

1. **Replikation von Level 1 (§ 2.2.1).** Die App-Pipeline läuft auf YC-0 und AD-100.
   - Die eigenen Gruppenmittel der App-SUVR (ganzes Kleinhirn) definieren 0 und 100 CL:
     YC-0 1,0311 und AD-100 2,0675. Standard: 1,009 / 2,076, also +2,2 % / −0,4 %.
   - Die so berechneten CL werden je Proband mit den veröffentlichten CL verglichen (Klunk 2015, Supplemental
     Table A).
   - Ergebnis: Steigung 0,995 (gefordert 0,98–1,02), Achsenabschnitt 0,28 CL (±2), R² 0,992 (> 0,98).
     **Erfüllt**, auch für die anderen drei Referenzregionen.
2. **Florbetaben als Surrogat-Tracer (§ 2.2.3.1)** an den 35 Probanden des FBB-Projekts:
   - App-FBB-SUVR = m · App-PiB-SUVR + b, mit m = 0,6099, b = 0,4085, R² 0,946 (gefordert > 0,70);
   - PiB-Calc-SUVR = (SUVR − b)/m;
   - CL mit den App-Ankern.
3. **Prüfung:**
   - Leave-one-out;
   - Vergleich mit den von GAAIN veröffentlichten CL (Standardmethode, Rowe 2017).

## Ergebnisse (Referenz ganzes Kleinhirn)

| Tracer | Gleichung der App | Herleitung | Übereinstimmung |
|---|---|---|---|
| PiB | CL = 96,49 · SUVR − 99,49 | § 2.2.1, n = 79 | Level 1: Steigung 0,995, Achsenabschnitt 0,28, R² 0,992, RMSE 4,5 CL; FBB-Projekt: Bias −0,2 CL, RMSE 4,4 CL |
| Florbetaben | CL = 158,20 · SUVR − 164,11 | § 2.2.3.1, n = 35 | gegen veröffentlichte FBB-CL: Bias −0,1 CL, LOO-RMSE 5,9 CL (max. 17,9) |

- **Junge Kontrollen** (Streuung als Maß des Rauschens):
  - YC-0: SD 4,9 CL (Standard 4,3);
  - FBB-Projekt: PiB 4,4 CL, Florbetaben 6,7 CL. Relative Varianz 1,54; Standard 1,95.
- **Gegen die veröffentlichten CL des FBB-Projekts** ist die Steigung beider Tracer 0,95. Ursache ist nicht die
  Gleichung, sondern die Kohorte: Die GAAIN-Werte des FBB-Projekts entstammen einer eigenen SPM8-Pipeline mit den
  Ankern 1,0186 / 2,0880.
- **Frühere Kalibrierungen:**
  - Bis November 2026 wurden die veröffentlichten CL direkt auf die App-SUVR regressiert:
    - PiB: 100,68 · SUVR − 105,61;
    - FBB: 164,06 · SUVR − 171,67.
  - Auf den Level-1-Daten verfehlte das die Replikationskriterien (Steigung 1,038).
  - Ebenso verfehlte sie eine Kalibrierung nach § 2.2.3.2 nur am FBB-Projekt (Steigung 1,044).
- Die nichtlineare Verformung (DCT) wird für Centiloid nicht verwendet: Gegen die Standardmethode war sie schlechter
  (FBB R² 0,92, Steigung 0,78, gegenüber affin R² 0,99, Steigung 0,93).
- **Kontrolle:** Die App im Browser liefert für einen Level-1-Probanden dieselben SUVR wie das Validierungsskript
  (relative Abweichung < 10⁻⁴).

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
