# Dosimetrie – Funktionsweise

Technische Beschreibung des Bereichs **Dosimetrie** (Therapie-Dosimetrie aus SPECT/CT bzw. PET/CT): Datenfluss,
Formeln, Entscheidungsregeln und Module. Die Bedienung steht im [Handbuch, Kapitel 9](MANUAL.md#9-dosimetrie-spectct).
Forschungswerkzeug, kein zertifiziertes Medizinprodukt.

---

## 1. Ablauf im Überblick

Der Ablauf folgt dem MIRD-/EANM-Schema:

1. **Zeitpunkte:** Je Messzeitpunkt ein Funktionsbild (SPECT/PET) mit CT, Zeit nach Injektion und Aufnahmedauer.
2. **Registrierung:** Die CTs aller Zeitpunkte werden rigide auf das CT von T1 registriert; Funktionsbild und
   Labelbilder folgen ihrem CT.
3. **Kalibrierung:** Bildwerte → Aktivität (MBq) je Voxel, über ein Kamera-Profil (Counts) oder direkt (Bq/ml).
4. **Regionen:** Organkarten (CT-Segmentierung) und bestätigte Läsionen; Aktivität, Volumen und Masse je Region und
   Zeitpunkt.
5. **Kurven:** Zeit-Aktivitäts-Kurve je Region, Fit → zeitintegrierte Aktivität (TIA, MBq·h).
6. **Dosis:** D = TIA × Energie pro Zerfall / Masse (lokale Energiedeposition), dazu BED, Unsicherheit und
   optional eine Voxel-Dosiskarte mit DVH.
7. **Bericht:** HTML mit allen Zwischenergebnissen.

Alles läuft im Browser; die Voxel-Dosiskarte in einem Web Worker. Der gesamte Zustand (`DosimetrySetup`,
`src/dosimetry/setup.ts`) wird in der Projektdatei gespeichert und ist abwärtskompatibel.

## 2. Zeitpunkte und Aufnahmesitzungen

**Gruppierung** (`src/dosimetry/sessions.ts`, `groupSessions`): Aus allen geladenen Datensätzen werden
Aufnahmesitzungen gebildet.

- Gleiche **FrameOfReference** → gleiche Sitzung.
- Sonst CT und Funktionsbild (oder zwei CTs) innerhalb von **90 min** Aufnahmezeit, und in derselben Studie
  (StudyInstanceUID), falls beide eine haben. Die nächstgelegenen Paare werden zuerst verbunden.
- Zwei Funktionsbilder mit unterschiedlicher FrameOfReference werden **nie** allein über die Zeit zusammengelegt –
  sie sind getrennte Zeitpunkte.
- Labelbilder folgen ihrem Ausgangsdatensatz (`derivedFrom`, z. B. „CT-Organe · <CT>“), sonst der FrameOfReference.
- Datensätze ohne Datum und ohne Verknüpfung (z. B. NIfTI) landen unter „Nicht zugeordnet“.

Beim ersten Öffnen wird je Sitzung mit Funktionsbild ein Zeitpunkt angelegt; später nur auf „Vorschlag übernehmen“,
manuelle Zuordnungen bleiben erhalten.

**Zeiten aus dem DICOM-Header** (`timePointFromHeader`, `calibration.ts`), alle überschreibbar:

| Größe | Quelle |
|---|---|
| Aufnahmezeit | Acquisition Date/Time (0008,0022/0032), sonst Series/Content |
| Injektion | Radiopharmaceutical Start Date Time (0018,1078) bzw. Start Time (0018,1072) |
| Aktivität | Radionuclide Total Dose (0018,1074) |
| Dauer | Actual Frame Duration (0018,1242) × Projektionen (0054,0053) × Detektoren (0054,0021), sonst eine Frame-Dauer |
| Einheit | Units (0054,1001): `BQML` oder `CNTS` |
| Zerfallskorrektur | Decay Correction (0054,1102): `NONE`, `START`, `ADMIN` |

t p.i. = Aufnahmezeit − Injektion (Stunden).

## 3. Registrierung

- „Zeitpunkte registrieren“ registriert jedes CT rigide auf das CT von T1 (vorhandene Koregistrierung,
  `src/registration`). Funktionsbild und Labelbilder desselben Zeitpunkts werden mit derselben Matrix mitbewegt.
- Ein Zeitpunkt gilt als **registriert**, wenn (a) er hier registriert wurde, (b) sein CT dieselbe FrameOfReference
  wie das CT von T1 hat, oder (c) die Matrix seines CTs von der des T1-CTs abweicht (also z. B. im Bereich
  „Koregistrierung“ platziert wurde).
- Alle Messungen tasten über diese Matrizen in einer gemeinsamen Weltkoordinate ab (`voxelMap`, trilinear in
  `dose.ts`). Unterschiedliche Raster von SPECT, CT und Labelbild sind dadurch kein Problem.

## 4. Kalibrierung und Einheiten

Je Zeitpunkt wird ein Faktor **MBq pro Bildwert und Voxel** (`mbqPerCount`) bestimmt. Priorität der Einheit:
manuell gewählt → Header (Units) → Kamera-Profil (`quantitative`).

**Quantitative Bilder (Bq/ml, z. B. xSPECT Quant, PET):** Standardprofil `QUANT_PROFILE`.

- MBq/Voxel = Wert × Voxelvolumen (ml) × 10⁻⁶.
- Ist das Bild auf die Injektion zerfallskorrigiert (`ADMIN`), wird mit e^(−λ·t p.i.) auf die Aufnahmezeit
  zurückgerechnet, damit die Kurve den tatsächlichen Verlauf zeigt.

**Counts:** Kamera-Profil mit Sensitivität CF (cps/MBq), zerfallskorrigiert während der Aufnahme
(`countsToMBq`):

  MBq = Counts / (T · CF) · λT / (1 − e^(−λT))

Bei einem bereits zerfallskorrigierten Bild entfällt der letzte Faktor.

**Kamera-Profile:** Name, Nuklid, CF, Kollimator, Energiefenster, Recovery-Koeffizienten (Volumen → RC,
logarithmisch interpoliert), Notiz. Gespeichert im Browser (ohne das eingebaute Profil) und in der Projektdatei,
Import/Export als JSON.

**Faktor aus Phantom** (`calibrationFromPhantom`, `PhantomCalibration.tsx`): Summe aller positiven Voxel einer
Phantom-SPECT (ganzes Phantom im Sichtfeld), bekannte Aktivität A₀ zum Zeitpunkt t₀ (Aktivimeter); Umkehrung von
`countsToMBq`:

  A(t_acq) = A₀ · e^(−λ(t_acq − t₀)),  CF = Counts · λT/(1 − e^(−λT)) / (T · A(t_acq))

**Kontrolle:** Aktivität im ganzen Sichtfeld (MBq und % der injizierten Aktivität) je Zeitpunkt.

## 5. Regionen

**Quelle der Labelbilder** (`labelSource`):

- **„Von T1 für alle“ (Standard):** Organkarte und Läsionen von T1 werden für alle Zeitpunkte verwendet. Über die
  Registrierung liegen sie in jedem Zeitpunkt anatomisch richtig. Schnell, und Läsionen bleiben dieselben Regionen.
- **„Pro Zeitpunkt“:** Jeder Zeitpunkt nutzt seine eigene Organkarte; fehlende CTs lassen sich nachsegmentieren.
  Läsionen gehen nur ein, wenn jeder Zeitpunkt eine Läsionskarte hat (dann über das Matching unten).

Regionen gleichen Namens werden über die Zeitpunkte verbunden (`regionKey`: Kleinschreibung, „_“ → Leerzeichen).
Vorauswahl: Nieren, Leber, Milz, Harnblase, Läsionen.

**Läsionen** kommen nur aus „Segmentierung und MTV“ (bestätigte Läsionen); die Dosimetrie segmentiert keine
Läsionen selbst. **Matching über Zeitpunkte** (`lesionMatch.ts`): Schwerpunkte je Läsion in Weltkoordinaten,
Kostenmatrix der Abstände, optimale Eins-zu-eins-Zuordnung mit der ungarischen Methode; Paare über der
Höchstdistanz (Standard 20 mm, einstellbar) bleiben unverbunden. Die Zuordnung ist in einer Tabelle sichtbar und
manuell korrigierbar.

**Messung je Region und Zeitpunkt** (`measureRegions`, `dose.ts`): Aktivität = Σ Bildwert × `mbqPerCount`,
Volumen = Voxelanzahl × Voxelvolumen, Masse aus der CT-Dichte:

  ρ = 1 + HU/1000 (bis Wasser, mindestens 0,001 g/ml),  ρ = 1 + 0,6 · HU/1000 (oberhalb)

Ohne CT gilt 1 g/ml. Die Aktivitätskonzentration wird an jedem Labelvoxel aus dem SPECT abgetastet und über das
Labelvoxel-Volumen integriert.

Optional je Region Division durch den Recovery-Koeffizienten des Profils für das Regionsvolumen.

Ein Fingerabdruck der Eingaben (`measuredSig`: Labelbilder, Läsionsverknüpfungen, Quelle, Zeitpunkte) erkennt
veraltete Messungen und zeigt einen Hinweis.

## 6. Zeit-Aktivitäts-Kurven und TIA

Modelle (`tacFit.ts`, Levenberg-Marquardt auf relativen Residuen):

| Modell | Kurve | Mindestpunkte |
|---|---|---|
| monoexponentiell | A·e^(−λt) | 2 |
| biexponentiell mit Aufnahme | A·(e^(−λ₁t) − e^(−λ₂t)) | 3 |
| Trapez + Ausläufer | Trapeze, nach dem letzten Punkt physikalischer Zerfall | 2 |
| Hänscheid | TIA = 2·A(t)·t/ln 2 | 1 |
| Madsen | TIA = A(t)·e^(λ_eff t)/λ_eff mit T_eff | 1 |

**Automatische Wahl:**

- 1 Punkt → Hänscheid (Madsen, wenn T_eff angegeben).
- 2 Punkte → monoexponentiell.
- ≥ 3 Punkte → biexponentiell, wenn die Aktivität zwischen den ersten beiden Punkten noch steigt und der Fit
  gelingt, sonst monoexponentiell; ab 5 Punkten das Modell mit dem kleineren AICc.
- Punkte ohne Aktivität → Trapez.
- Die Auswaschung ist nie langsamer als der physikalische Zerfall (λ ≥ λ_phys).

**Akaike-Gewichte** (ab 4 Punkten): wᵢ = e^(−Δᵢ/2) / Σⱼ e^(−Δⱼ/2), Δᵢ = AICcᵢ − min AICc, dazu die gewichtete TIA.
Nur zur Information; die Wahl folgt den Regeln oben.

**Unsicherheit der TIA:** aus der Kovarianz der Fitparameter (Delta-Methode).

## 7. Dosis, BED und Unsicherheit

**Lokale Energiedeposition** (`localDepositionDose`, `nuclideData.ts`):

  D (Gy) = TIA (MBq·h) · 3,6·10⁹ Zerfälle/(MBq·h) · E (keV) · 1,602·10⁻¹⁶ J/keV / m (kg)

E ist die mittlere Elektronenenergie pro Zerfall (ICRP 107, Tabelle unten). Photonen gehen nur über einen
Dosis-Voxel-Kernel ein.

**BED** je Region bei monoexponentieller Auswaschung (`bedMono`):

  BED = D + D² · λ / ((μ + λ) · α/β),  λ = ln 2/T_eff,  μ = ln 2/T_rep

Vorgabe Nieren α/β = 2,6 Gy, T_rep = 2,8 h; für jede Region editierbar.

**Unsicherheit der Dosis** nach EANM 2018 (Gear et al., `uncertainty.ts`): unabhängige relative Beiträge in
Quadratur,

  u_rel(D)² = u_Fit² + u_Kalibrierung² + u_RC² + u_Volumen²

Die Kalibrierung wirkt systematisch auf alle Zeitpunkte und damit voll auf die TIA; RC nur, wenn für die Region
angewendet. Für Kalibrierung, RC und Volumen gibt es bewusst keine Vorgabewerte – sie stammen aus den eigenen
Phantommessungen. Ausgewiesen werden Gesamtwert (k = 1) und Anteile.

## 8. Voxel-Dosiskarte

Berechnung im Web Worker (`src/workers/dosimetry.worker.ts`, `runner.ts`), mit Fortschritt und Abbruch:

1. Raster = SPECT von T1; alle Zeitpunkte werden über ihre Registrierung darauf abgetastet.
2. **TIA je Voxel** (`integrate`): monoexponentiell (log-linear) oder Trapez + Ausläufer; bei einem Zeitpunkt
   Hänscheid.
3. **Dichte** je Voxel aus dem CT (`densityMap`).
4. **Dosis** (`doseFromTia`): lokale Deposition, oder Faltung mit einem geladenen Kernel (Tabelle „i j k S“, Oktant
   genügt, Voxelgröße = SPECT) per FFT (`convolve3d`), skaliert mit ρ_Wasser/ρ.
5. Mit Kernel werden **beide** Karten gerechnet und je Region D_LED, D_Kernel und Δ % verglichen; als Datensatz
   „Dosis (Gy)“ wird die gewählte angelegt.
6. **DVH** je Region (`dvh`) mit D2 %, D50 %, D98 %.

## 9. Bericht

`report.ts` erzeugt eine eigenständige HTML-Datei, die in der App angezeigt wird (`ReportOverlay`) und sich
herunterladen oder über den Browser als PDF drucken lässt. Inhalt: Patient-ID, Nuklid mit Energie und Quelle,
Kamera-Profil bzw. Bq/ml, Injektion, Tabelle der Zeitpunkte (Datum, t p.i., Dauer, Datensätze, registriert), je
Region Masse, Aktivitäten, Modell und Parameter, Akaike-Gewichte, TIA ± u, Dosis ± u mit Anteilen, LED/Kernel, BED,
DVH-Kennwerte, Kurven als SVG, Methodik und Quellen. Dateiname mit Patienten-ID-Präfix.

## 10. Nukliddaten

Mittlere Energie pro Zerfall nach **ICRP Publication 107** (Summen nach MIRDspecs):

| Nuklid | Elektronen (keV/Zerfall) | davon β⁻ | Photonen (keV/Zerfall) | Halbwertszeit |
|---|---|---|---|---|
| Lu-177 | 147,92 | 133,3 | 35,09 | 6,647 d |
| Tb-161 | 202,48 | 154,3 | 36,52 | 6,906 d |
| I-131 | 191,84 | 181,9 | 382,75 | 8,021 d |
| Y-90 | 933,1 | 932,9 | 0 | 64,1 h |

Die Halbwertszeiten gelten auch für den Nuklid-Editor im DICOM-Header.

## 11. Module

| Datei | Inhalt |
|---|---|
| `src/dosimetry/sessions.ts` | Gruppierung in Aufnahmesitzungen, Zeit p.i. |
| `src/dosimetry/calibration.ts` | Kamera-Profile, Bq/ml-Profil, RC, Header-Zeiten, Counts → MBq, Phantom-Kalibrierung |
| `src/dosimetry/dose.ts` | Abtastung über Registrierungen, Dichte aus HU, Aktivität/Volumen/Masse je Region |
| `src/dosimetry/lesionMatch.ts` | Läsionsschwerpunkte, ungarische Zuordnung |
| `src/dosimetry/tacFit.ts` | Kurvenmodelle, Levenberg-Marquardt, AICc, Akaike-Gewichte, Hänscheid/Madsen |
| `src/dosimetry/nuclideData.ts` | Energien pro Zerfall (ICRP 107), lokale Deposition |
| `src/dosimetry/uncertainty.ts` | Unsicherheit der Dosis (EANM 2018) |
| `src/dosimetry/voxelDose.ts` | Voxel-TIA, Dichtekarte, Kernel-Parser, FFT-Faltung, DVH |
| `src/dosimetry/runner.ts`, `src/workers/dosimetry.worker.ts` | Voxel-Dosiskarte im Worker |
| `src/dosimetry/report.ts`, `ReportOverlay.tsx` | HTML-Bericht |
| `src/dosimetry/setup.ts` | Zustand (Projektdatei), BED |
| `src/dosimetry/DosimetryPanel.tsx`, `TimePointsCard.tsx`, `TimeAxis.tsx`, `PhantomCalibration.tsx` | Oberfläche |

**Wiederverwendet:** Koregistrierung (`src/registration`), CT-Organsegmentierung (`src/segmentation`), Läsionen
(`src/tumor`), `Chart` (Kinetik), `BigTable`, Projektdatei, Nuklidtabelle (`src/header/radionuclide.ts`).

## 12. Verifikation

- **Unit-Tests** (`src/dosimetry/*.test.ts`): Sitzungs-Gruppierung; Kalibrierung, RC, Header-Zeiten (auch binäre
  US-Werte); Phantom-Kalibrierung im Rundlauf mit `countsToMBq`; Fits mit 1–4 Zeitpunkten, Rauschen, Grenze durch
  den physikalischen Zerfall; Akaike-Gewichte; Hänscheid/Madsen, Trapez; lokale Deposition (1 GBq Y-90 in 1 kg
  ≈ 49,7 Gy); Regionsmessung über verschiedene Raster; Läsionszuordnung; Unsicherheit; Voxel-TIA, Kernel-Faltung
  (Delta- und versetzter Kernel), DVH, BED; Bericht; ICRP-107-Werte.
- **Browser (11/2026), synthetisches DICOM-Phantom** mit 3 Aufnahmen (24/48/96 h, je CT + SPECT mit Datum und
  Injektion; Niere T_eff 40 h, Leber 60 h; zwei Läsionen mit Verschiebung und vertauschter Nummerierung):
  Gruppierung, Registrierung, Läsionszuordnung (4 mm / 0 mm), Niere 4,78 Gy (Handrechnung 4,79 Gy), Leber-TIA
  5190 MBq·h (5194), Voxelkarte und DVH konsistent, Bericht vollständig. Phantom-Kalibrierung: 10,0 cps/MBq wie
  vorgegeben.
- **Reale Daten:** xSPECT/CT mit 4 Zeitpunkten (Bq/ml), Organkarte von T1 für alle Zeitpunkte – Kurven mit allen
  Punkten (siehe Handbuch, Kapitel 9).

## 13. Grenzen und offene Punkte

**Funktionen**

- [ ] **OpenDose-Dosis-Voxel-Kernel laden** (OpenDoseDVKData, Apache 2.0) – Priorität hoch. Parser für deren Format
  (vorher am Repository prüfen), Kernel passender Voxelgröße wählen bzw. auf das SPECT-Raster umrechnen
  (Integral erhalten). Vorerst nur aus lokaler Datei.
- [ ] **Photonen-Selbstdosis ohne Kernel (Kugelmodell)** – absorbierte Fraktion φ(m, E) für Kugeln gleicher Masse;
  Daten (ICRP 107, NIST μ_en/ρ) vorher aus geprüfter Quelle. Vor allem für I-131.
- [ ] **Populations-T_eff-Vorgaben für Madsen** – je Tracer und Organ mit Literaturquelle; nichts aus dem Gedächtnis.
- [ ] **Totzeitkorrektur** im Kamera-Profil (I-131, frühe Lu-177-Aufnahmen).
- [ ] **RC-Kurve aus NEMA-Kugeln** (Kugel-VOIs aus bekannten Durchmessern).
- [ ] **Deformierbare Registrierung** der Zeitpunkte (Nieren, Leber).
- [ ] **Knochenmark-Dosimetrie** (blut- oder bildbasiert, L2–L4).
- [ ] **Speichel- und Tränendrüsen** – nicht im CT-Modell; heute eigene Segmentierung als NIfTI.
- [ ] **Weitere Nuklide** (Ho-166, Cu-67) – nur aus ICRP 107/MIRDspecs, mit Test.
- [ ] **Organ-S-Werte (OpenDose, ICRP 110) als Gegenprobe** – Lizenz unklar, höchstens Import einer selbst geladenen
  Tabelle.

**Prüfung und Validierung**

- [ ] Phantommessung (NEMA-Kugeln) mit eigenem Kalibrierfaktor: Kalibrierung und RC prüfen.
- [ ] Vergleich mit OpenDose3D an einem Patientendatensatz (nicht ins Repository): gleiche Kalibrierung, VOIs (als
  NIfTI exportiert) und Fitmodell, damit nur die Rechnung verglichen wird.
- [ ] Kernel-Faltung mit einer echten Voxel-S-Wert-Tabelle (OpenDose-DVKs; Gegenprobe Lanconelli 2012).
- [ ] **Validierung an öffentlichen Referenzdaten** – Priorität hoch: SNMMI Dosimetry Challenge 2021 und
  MRTDosimetry-4-Organ-Phantom; Maßstab < 3 % wie OpenDose3D. Nutzungsbedingungen vorher klären.

**Bekannte Grenzen:** Rigide Registrierung; Photonen nur über Kernel; Faltung mit Wasserkernel in Lunge/Knochen nur
genähert; Eingang ist die Geräte-Rekonstruktion (die eigene Rekonstruktion der App ist nicht für Dosimetrie gedacht).

## Quellen (Methodik)

- MIRD-Pamphlet 23 und 26 (quantitative SPECT, Lu-177).
- EANM Dosimetry Committee: Empfehlungen zur Dosimetrie von Lu-177-SSTR- und PSMA-Liganden (2022); Gear JI et al.,
  Leitfaden zur Unsicherheitsanalyse, EJNMMI Physics 2018.
- Hänscheid et al., Madsen et al.: Ein-Zeitpunkt-Dosimetrie.
- Sarrut et al.: voxelweise Modellwahl (VoMM).
- Lanconelli et al., Phys Med Biol 2012: Voxel-S-Werte.
- ICRP Publication 107 (Eckerman & Endo 2008): Zerfallsdaten.

---

## Abgleich mit OpenDose3D (Recherche 21.11.2026)

**Grundlage:** Fragoso-Negrín et al., *OpenDose3D: A Free, Open-Source Clinical Dosimetry Software for Patient-Specific Dosimetry*, J Nucl Med 2026; 67(2):276–282 (online 09/2025), dazu GitLab-Projekt, Slicer-Extension und Folgearbeiten.
**Einschränkung:** Der Volltext (PMC, jnm.snmjournals.org) war aus der Arbeitsumgebung nicht abrufbar. Die Angaben stammen aus Abstract, Textauszügen über die Websuche und Begleitquellen. Punkte mit „prüfen“ vor der Umsetzung am Volltext bzw. Repository bestätigen.

### OpenDose3D in Kürze

- **Was:** Freie Software für retrospektive, bildbasierte, patientenspezifische Dosimetrie in der Nuklearmedizin. Erweiterung von **3D Slicer** (Python-API), offizielle Slicer-Extension (Kategorie Radiotherapy). Version 1.0 ist die erste stabile Version.
- **Lizenz:** **Apache 2.0** (Software und Kernel-Daten). Der Artikel selbst steht unter CC BY 4.0. Ausdrücklich Forschungs- und Lehrwerkzeug, keine FDA-/CE-Zulassung geplant.
- **Eingang:** Rekonstruierte SPECT/CT- **oder PET/CT**-Serien über das Slicer-DICOM-Modul. Kalibriermodul oder manueller Sensitivitätsfaktor.
- **Nuklide:** u. a. Cu-64, Cu-67, F-18, Ga-68, Ho-166, I-124, I-131, In-111, Lu-177, Sm-153, Tb-161, Tc-99m, Y-90 (Liste im Abstract abgeschnitten; prüfen).
- **Ablauf:** Zwei Workflows, optional automatisch:
  1. **Activity:** Aktivität je VOI → Zeit-Aktivitäts-Kurve → TIA → Dosis per **lokaler Energiedeposition (LED)**.
  2. **Absorbed Dose Rate (ADR):** Dosisleistungsbild je Zeitpunkt per **LED, Faltung (CONV, FFT mit DVK) oder Monte Carlo (MC)** → mittlere ADR je VOI → Kurve → Dosis.
  - In beiden Fällen wird **auf VOI-Ebene** gefittet und integriert (keine voxelweise Integration).
- **Registrierung:** Über das Slicer-Modul **Elastix** (rigide und deformierbar möglich).
- **Segmentierung:** Manuell/halbautomatisch in Slicer; **TotalSegmentator** nur für CT-definierte Risikoorgane.
- **Fit:** lmfit mit mono-, bi- und tri-exponentiellen Modellen. Über die **NUKFIT**-Integration elf Funktionen (Parametrisierungen dieser Modelle). Modellwahl über **Akaike-Gewichte**. Parameterunsicherheit, wenn weniger Parameter als Zeitpunkte.
- **Dichtekorrektur:** Lokal aus der Voxeldichte, für LED und CONV. Für LED exakt, für CONV eine Näherung, weil die räumliche Energieverteilung weiter aus dem Kernel (Wasser oder gewähltes Medium) stammt. Ohne Korrektur wird homogenes Wasser angenommen.
- **Kernel:** Vorberechnete Voxel-S-Werte (VSV) in Wasser und anderen Medien im Repository **OpenDoseDVKData**: für alle unterstützten Nuklide, Voxelgrößen 0,1–6,0 mm, Kernelgröße 99 × 99 × 99 Voxel, Apache 2.0.
- **Monte Carlo:** Nicht eingebaut. OpenDose3D erzeugt aus Aktivitäts- und Dichtekarte eine **GATE-9**-Eingabe, rechnet extern und liest das Ergebnis wieder ein. Zerfallsdaten über die GATE-Ionenquelle.
- **PVE:** Recovery-Korrektur nur, wenn eine RC-Kurve vorliegt.
- **Ausgabe:** Tabellen je Segment mit Dosis und Unsicherheit, DVH, Export der Zwischenergebnisse für Methodenvergleiche, Berichtsmodul (v1.0).

### Validierung in der Arbeit

- Phantome: Jaszczak, NEMA und das **4-Organ-Phantom** des Projekts MRTDosimetry (Leber, Milz, Nieren, Lebertumor; Aktivität, TIA und Dosis bekannt). Sensitivität und RC im Vergleich mit Tran-Gia et al.
- Bilddaten der **SNMMI Dosimetry Challenge 2021**.
- Ergebnis: Abweichung **< 3 %** für Kalibrierung sowie TIA und Dosis der Organkompartimente. Phantom-Dosimetrie in etwa 30 min.
- Begleitstudie (Physica Medica 2025, Algorithmenvergleich LED/CONV/MC): Im heterogenen Medium ist die Dichtekorrektur entscheidend. Bei **I-131 unterschätzt LED die Dosisleistung in Lunge und Knochenmark um bis zu 50 %**. CONV stimmt in Weichteil mit MC auf ~1 % überein, gut auch in Organen mit überwiegender Selbstbestrahlung.
- Unabhängig: DosimeTron (arXiv 2026) gegen OpenDose3D an 114 Fällen, Pearson r median 0,997, mittlere absolute Abweichung < 5 % für 19 von 22 Organen.

### Vergleich mit Recon Studio (Stand 11/2026)

| Funktion | OpenDose3D | Recon Studio | Bemerkung |
|---|---|---|---|
| Plattform | 3D Slicer, Python, Desktop | Browser, TypeScript, ohne Server | Architektur bewusst nicht übernommen |
| Eingangsbilder | SPECT/CT, PET/CT | SPECT/PET in Counts oder Bq/ml | gleichwertig |
| Kalibrierung | Kalibriermodul | Kamera-Profile, Faktor aus Phantom, RC-Tabelle | RC aus NEMA-Kugeln offen |
| Registrierung | Elastix (rigide/deformierbar) | rigide CT-CT | deformierbar offen |
| Läsionen über Zeitpunkte | manuell/Registrierung | Schwerpunkt-Matching (ungarische Methode) | – |
| Fitmodelle | mono/bi/tri, 11 NUKFIT-Funktionen | mono, bi mit Aufnahme, Trapez, Hänscheid, Madsen | kein Ausbau (bei 3–4 Punkten nicht bestimmbar) |
| Modellwahl | Akaike-Gewichte | Regeln/AICc, Akaike-Gewichte als Information | – |
| Unsicherheit | Fitparameter | Fit, Kalibrierung, RC, Volumen (EANM 2018) | – |
| Workflow | Activity (LED) und ADR (LED/CONV/MC) | Regionen (LED) und voxelweise TIA → Dosis | ADR ohne MC kein Gewinn |
| DVK-Faltung | OpenDose-DVKs | eigene Kerneltabelle | **OpenDose-DVK-Import offen** |
| Methodenvergleich | Zwischenergebnisse | LED und Kernel nebeneinander | – |
| Monte Carlo | extern über GATE 9 | keine | im Browser nicht realistisch |
| Nuklide | ≥ 13 | 4 | Ho-166, Cu-67 nach Bedarf |
| Bericht | Berichtsmodul | HTML-Bericht (in der App, Drucken/PDF) | – |
| Validierung | Phantome, SNMMI Challenge, < 3 % | Unit-Tests, synthetische Phantome | Referenzdaten offen |

**Hinweis aus der Literatur:** Für I-131 in Lunge und Knochen ist auch die Faltung mit Wasserkernel nur eine
Näherung; LED unterschätzt dort die Dosisleistung um bis zu 50 %.

### Quellen

- Fragoso-Negrín J-A et al. OpenDose3D: A Free, Open-Source Clinical Dosimetry Software for Patient-Specific Dosimetry. J Nucl Med 2026; 67(2):276–282. https://pmc.ncbi.nlm.nih.gov/articles/PMC12866356/ · https://jnm.snmjournals.org/content/67/2/276
- OpenDose3D, Quellcode (Apache 2.0): https://gitlab.com/opendose/opendose3d
- OpenDoseDVKData, Dosis-Voxel-Kernel (Apache 2.0): https://gitlab.com/opendose/opendosedvkdata
- Slicer-Extension OpenDose3D: https://extensions.slicer.org/view/OpenDose3D/35390/linux/amd64 · Forum: https://discourse.slicer.org/t/opendose3d-a-slicer-module-to-perform-3d-patient-specific-dosimetry-based-on-images-in-molecular-radiotherapy/20747
- Methodology for comparing absorbed dose rate calculation algorithms in molecular radiotherapy dosimetry. Phys Med 2025. https://pubmed.ncbi.nlm.nih.gov/40215838/
- OpenDose: Open-Access Resource for Nuclear Medicine Dosimetry. J Nucl Med 2020; 61(10):1514. https://jnm.snmjournals.org/content/61/10/1514 · Daten: https://www.opendose.org
- OpenDose-S-Werte, ICRP-110-Erwachsenenphantome (Zenodo): https://zenodo.org/records/23841128
- Bardiès M. OpenDose3D: a free/open clinical dosimetry software for nuclear medicine (EURADOS Winter School 2022): https://eurados.sckcen.be/sites/eurados/files/uploads/Actions/Winter%20schools/AM2022/13_Bardies.pdf
- DosimeTron: Automating Personalized Monte Carlo Radiation Dosimetry in PET/CT with Agentic AI (arXiv 2026): https://arxiv.org/pdf/2604.06280
- Gear JI et al. EANM practical guidance on uncertainty analysis for molecular radiotherapy absorbed dose calculations. EJNMMI 2018.
