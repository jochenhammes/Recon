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

GAAIN Florbetaben-Projekt (Rowe et al., Eur J Nucl Med Mol Imaging 2017;44:2053–2059): 35 Probanden (25 ältere,
10 junge Kontrollen) mit T1-MRT, Florbetaben-PET (90–110 min) und PiB-PET (50–70 min) sowie den von GAAIN
veröffentlichten SUVR- und Centiloid-Werten der SPM8-Standardmethode. Die Daten werden nicht mitgeliefert
(GAAIN-Nutzungsbedingungen).

## Vorgehen (Centiloid „Level 2“)

Die App-Pipeline wird auf alle 35 Datensätze angewendet. Die veröffentlichten Centiloid-Werte der Standardmethode
werden per linearer Regression (kleinste Quadrate) aus dem App-SUVR (ganzes Kleinhirn) vorhergesagt:
`CL = Steigung · SUVR_App + Achsenabschnitt`. Die Güte wird per Leave-one-out-Kreuzvalidierung angegeben
(Kalibrierung jeweils ohne den vorhergesagten Probanden).

## Ergebnisse

Übereinstimmung App-SUVR mit Standard-SUVR (Florbetaben, Referenz ganzes Kleinhirn):

| Normalisierung T1 → MNI | R² | Steigung | Achsenabschnitt | CL-Fehler mit Rowe-Gleichung (RMSE / max.) |
|---|---|---|---|---|
| affin (verwendet) | 0,990 | 0,926 | 0,114 | 7,0 / 17,2 CL (Bias +2,6) |
| affin + nichtlinear (bis Version vom 17.11.2026) | 0,921 | 0,775 | 0,378 | 21,8 / 47,2 CL (Bias +12,8) |

Kalibrierte Gleichungen der App (Referenz ganzes Kleinhirn):

| Tracer | Gleichung | n | R² | Kreuzvalidierung RMSE (max.) |
|---|---|---|---|---|
| Florbetaben | CL = 164,06 · SUVR − 171,67 | 35 | 0,990 | 5,8 CL (16,7) |
| PiB | Kalibrierung läuft – bis dahin Standardgleichung (Klunk 2015) | | | |

Andere Referenzregionen (Florbetaben, nur zur Information): Kleinhirn + Hirnstamm R² 0,991 (RMSE 5,6 CL),
Kleinhirnrinde 0,985 (7,6 CL), Pons 0,988 (6,5 CL).

Kontrolle: Die App im Browser liefert für einen Probanden denselben SUVR wie das Validierungsskript (1,419 vs. 1,420).

## Grenzen

- Die Kalibrierung gilt nur für die automatische MRT-Pipeline der App. Für extern (z. B. mit SPM) normalisierte Daten
  die Standardgleichungen (Rowe 2017, Klunk 2015) verwenden.
- PET-only (ohne MRT) ist nicht validiert.
- Kalibriert an 35 Probanden eines Scanners/Zentrums; die Werte sind nicht für die klinische Diagnostik zugelassen.

## Reproduktion

Skript (lokal, nicht im Repository, da es die GAAIN-Daten benötigt): wendet `runCentiloidPipeline`
(`src/centiloid/pipeline.ts`, gleiche Schritte wie die App) auf alle Probanden an und schreibt die VOI-Mittelwerte als
CSV; die Regression erfolgt mit den GAAIN-Tabellen (`FBBproject_SupplementaryTable.xlsx`).
