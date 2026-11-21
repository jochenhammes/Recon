# Dosimetrie – offene Punkte und Umsetzungsstand

Sammlung für den Bereich **Dosimetrie** (Therapie-Dosimetrie aus SPECT/CT). Benutzerdoku: [MANUAL.md, Kapitel 9](MANUAL.md#9-dosimetrie-spectct).
Forschungswerkzeug, kein zertifiziertes Medizinprodukt.

---

## Offene Punkte

### Funktionen

- [x] **Läsionen über Zeitpunkte zuordnen (Schwerpunkt-Matching)** – *umgesetzt (11/2026): ungarische Methode, max. 20 mm (einstellbar), Tabelle mit Abständen, manuell korrigierbar; `src/dosimetry/lesionMatch.ts`*
  - **Heute:** Regionen werden nur über den Namen verbunden. Läsionsbilder je Zeitpunkt („Läsion 3“ …) passen deshalb nicht zusammen.
  - **Umgehung:** Läsionen einmal segmentieren und für alle registrierten Zeitpunkte verwenden („alle Zeitpunkte“).
  - **Vorschlag:**
    - Nach der Registrierung die Läsionsschwerpunkte aller Zeitpunkte in Referenz-Weltkoordinaten berechnen.
    - Die nächstgelegenen Läsionen innerhalb von z. B. 15–20 mm zuordnen (ungarische Zuordnung oder Greedy nach Abstand).
    - Die Zuordnung in der UI anzeigen und korrigierbar machen.
- [ ] **Photonen-Selbstdosis ohne Kernel (Kugelmodell)**
  - **Heute:** Photonen gehen nur über einen geladenen Dosis-Voxel-Kernel ein; die lokale Deposition rechnet nur mit Elektronen.
  - **Vorschlag:** Absorbierte Photonenfraktion φ(m, E) für Kugeln gleicher Masse.
    - Tabellen nach Stabin & Konijnenberg 2000 bzw. OLINDA-Sphere-Model, oder Näherung über μ_en(E) von Wasser.
    - **Benötigte Daten:** Photonenspektren je Nuklid (ICRP 107) und μ_en/ρ von Wasser (NIST). Beides vor der Umsetzung aus geprüfter Quelle beschaffen.
  - **Relevanz:** Vor allem für I-131 (382,75 keV Photonen/Zerfall); bei Lu-177 und Tb-161 nur einige Prozent.
- [ ] **Populations-T_eff-Vorgaben für Ein-Zeitpunkt-Dosimetrie (Madsen)**
  - **Heute:** Feld leer, Wert von Hand eintragen. Hänscheid braucht keinen Wert.
  - **Vorschlag:** Editierbare Vorgaben je Tracer und Organ (Lu-PSMA, Lu-DOTATATE; Nieren, Leber, Milz, Läsionen) mit Literaturquelle in der App. Werte vor der Umsetzung aus den Originalarbeiten prüfen; nichts aus dem Gedächtnis eintragen.
- [ ] **Totzeitkorrektur**
  - Optionaler Parameter im Kamera-Profil, z. B. paralysierbare Totzeit τ oder Korrekturkurve über der Zählrate.
  - Relevant bei I-131 und frühen Lu-177-Aufnahmen.
- [x] **Rechnung im Web Worker** – *umgesetzt für die Voxel-Dosiskarte (Zeitintegral, Dichte, Faltung; abbrechbar; `src/workers/dosimetry.worker.ts`). Die Regionsmessung bleibt im Hauptthread (schnell genug).*
  - Messung, Voxel-TIA und Kernel-Faltung laufen derzeit im Hauptthread mit kurzen Pausen.
  - Bei großen Datensätzen kann die Oberfläche stocken. Umzug nach `src/workers/` analog zu Koregistrierung und Kinetik.
- [ ] **Deformierbare Registrierung der Zeitpunkte**
  - Derzeit nur rigide CT-CT-Registrierung.
  - Für Voxel-Dosimetrie in beweglichen Organen (Nieren, Leber) wäre eine deformierbare Registrierung genauer, z. B. auf Basis der vorhandenen DCT-Normalisierung.
- [ ] **Knochenmark-Dosimetrie**
  - Blutbasiert oder bildbasiert über eine L2–L4-VOI; derzeit nicht vorgesehen.
- [ ] **Speichel- und Tränendrüsen**
  - Nicht im CT-Modell (TotalSegmentator total 3 mm).
  - Heute: eigene Segmentierung als NIfTI laden. Optional: VOI-Werkzeug direkt im Dosimetrie-Bereich.
- [x] **FrameOfReference bei DICOM ohne Positionsangaben** – *umgesetzt: Ersatz-Geometrie behält die FoR*
  - Fehlen Image Position/Orientation, geht beim Laden auch die FrameOfReference verloren (`buildDicomVolume` in `src/viewer/volumeLoader.ts`).
  - Das CT wird dann nicht automatisch dem Zeitpunkt zugeordnet.
  - **Vorschlag:** FrameOfReference auch in die Ersatz-Geometrie übernehmen.
- [x] **Bericht** – *umgesetzt als HTML (Drucken/PDF über den Browser), `src/dosimetry/report.ts`*: Zusammenfassung pro Patient (Tabelle, Kurven, DVH, Parameter, Quellen) als PDF/HTML zusätzlich zur CSV.
  - **Ergänzung (OpenDose3D-Abgleich):** OpenDose3D hat seit v1.0 ein eigenes Berichtsmodul. Priorität daher anheben. Der Bericht soll alle Zwischenergebnisse nennen: Kalibrierfaktor, RC, Zeitpunkte, Modell und Fitparameter, TIA ± Unsicherheit, Methode (LED/Kernel), Kernelquelle und Dichtekorrektur. So bleiben Ergebnisse mit anderer Software vergleichbar.

#### Neu aus dem Abgleich mit OpenDose3D (Details im [Abschnitt unten](#abgleich-mit-opendose3d-recherche-21112026))

- [ ] **OpenDose-Dosis-Voxel-Kernel laden (OpenDoseDVKData, Apache 2.0)** – Priorität hoch, Aufwand M
  - **Heute:** Nur eigene Tabelle „i j k S“ in genau der SPECT-Voxelgröße.
  - **Vorschlag:**
    - Import-Parser für das Dateiformat von OpenDoseDVKData (Format, Einheit und Normierung vorher am Repository prüfen; nicht aus dem Gedächtnis annehmen).
    - Kernel passender Voxelgröße wählen. Bei abweichender oder anisotroper SPECT-Voxelgröße den Kernel auf das SPECT-Raster umrechnen (Integral erhalten) statt abzulehnen.
    - 99 × 99 × 99 Voxel sind für die FFT unkritisch; Kernel optional auf einen Radius kürzen (Energie außerhalb anzeigen).
    - **Weitergabe:** Apache 2.0 erlaubt das Mitliefern einzelner Kernel mit Lizenztext und NOTICE/Quellenangabe. Vorerst nur Laden aus einer lokalen Datei, kein Nachladen zur Laufzeit von fremden Servern.
- [x] **LED und Kernel nebeneinander rechnen** – *umgesetzt: Methodenvergleich je Region in der Karte Voxel-Dosiskarte und im Bericht* – Priorität mittel, Aufwand S
  - Beide Dosiskarten (lokale Deposition und Faltung) erzeugen und je Region die relative Abweichung zeigen.
  - OpenDose3D gibt Zwischenergebnisse gezielt für solche Methodenvergleiche aus. Bei uns ist es eine billige Plausibilitätsprüfung, vor allem für I-131 und Y-90.
- [x] **Kalibrierfaktor aus einer Phantomaufnahme bestimmen** – *umgesetzt (Gesamtzählung im Sichtfeld); RC-Kurve aus NEMA-Kugeln bleibt offen* – Priorität mittel, Aufwand S–M
  - Heute wird cps/MBq von Hand eingetragen; OpenDose3D hat ein eigenes Kalibriermodul.
  - **Vorschlag:** Phantom-SPECT laden, bekannte Aktivität und Messzeitpunkt eintragen, Faktor aus der Gesamtzählrate (zerfallskorrigiert) berechnen und ins Kamera-Profil übernehmen.
  - **Später:** RC-Kurve aus NEMA-Kugeln (Kugel-VOIs aus bekannten Durchmessern).
- [x] **Quantitative Eingangsbilder in Bq/ml (PET, quantitative SPECT)** – *umgesetzt; ADMIN-zerfallskorrigierte Bilder werden auf die Aufnahmezeit zurückgerechnet* – Priorität mittel, Aufwand S
  - OpenDose3D nimmt neben SPECT/CT auch PET/CT (z. B. Y-90-PET, I-124, Cu-64).
  - Bei uns geht nur „CNTS“; andere Einheiten erzeugen nur einen Hinweis.
  - **Vorschlag:** Bei Einheit BQML (0054,1001) Kalibrierung überspringen, Zerfallskorrektur aus dem Header beachten.
- [x] **Unsicherheit nach EANM 2018 vollständig fortpflanzen** – *umgesetzt (Fit, Kalibrierung, RC, Volumen; Eingabewerte ohne Vorgaben), `src/dosimetry/uncertainty.ts`* – Priorität mittel, Aufwand M
  - Heute nur die Fit-Kovarianz.
  - **Vorschlag:** Relative Unsicherheiten für Kalibrierfaktor, RC und Volumen/Masse (editierbar, Vorgaben mit Quelle) bis zur Dosis fortpflanzen und getrennt ausweisen.
- [x] **Akaike-Gewichte anzeigen** – *umgesetzt (mit gewichteter TIA, nur Information)* – Priorität niedrig, Aufwand S
  - OpenDose3D wählt das Modell über Akaike-Gewichte. Wir haben AICc bereits; die Gewichte (und ggf. ein gewichtetes Mittel der TIA) sind wenige Zeilen.
  - **Keine** Übernahme aller elf NUKFIT-Funktionen: Mit 3–4 Zeitpunkten sind tri-exponentielle Modelle nicht bestimmbar.
- [ ] **Weitere Therapienuklide** – Priorität niedrig, Aufwand S je Nuklid
  - OpenDose3D unterstützt u. a. Ho-166, Cu-67, Sm-153, Cu-64, I-124 (vollständige Liste im Artikel prüfen).
  - Sinnvoll vor allem Ho-166 (Radioembolisation) und Cu-67. Werte nur aus ICRP 107 bzw. MIRDspecs übernehmen und mit Test absichern.
- [ ] **Organ-S-Werte (OpenDose, ICRP-110-Phantome) als Gegenprobe** – Priorität niedrig, Aufwand M
  - Organdosis inkl. Photonen-Kreuzdosis nach MIRD-Schema, mit Massenskalierung auf die Patientenorgane.
  - **Lizenz:** Für die OpenDose-S-Werte wurde keine offene Lizenz gefunden, nur „für Forschung und Lehre, ohne Haftung“. Daher nichts ins Repository übernehmen; höchstens Import einer vom Nutzer selbst geladenen Tabelle.

### Prüfung und Validierung

- [ ] Registrierung der Zeitpunkte an echten SPECT/CT-Daten im Browser prüfen. Dazu gehört das Zusammenspiel mehrerer CTs, der Organkarten und der Mitbewegung von SPECT und Labelbildern.
- [ ] Phantommessung (NEMA-Kugeln) mit eigenem Kalibrierfaktor: Kalibrierung und Recovery-Koeffizienten prüfen.
- [ ] Vergleich mit OpenDose3D (3D Slicer) an einem Patientendatensatz (nicht ins Repository).
  - **Ergänzung:** Gleiche Kalibrierung, gleiche VOIs (als NIfTI aus Recon Studio exportiert) und gleiches Fitmodell vorgeben, damit nur die Rechnung verglichen wird. In OpenDose3D den Activity-Workflow mit LED und den ADR-Workflow mit CONV nutzen.
- [ ] Kernel-Faltung mit einer echten Voxel-S-Wert-Tabelle (z. B. Lanconelli 2012 für Lu-177 / I-131 / Y-90) prüfen. Lizenz für eine eventuelle Weitergabe im Repository klären.
  - **Ergänzung:** Die OpenDose-DVKs (OpenDoseDVKData) stehen unter Apache 2.0 und sind damit die naheliegende Quelle mit klarer Lizenz. Gegenprobe mit Lanconelli 2012 bleibt sinnvoll.
- [ ] **Validierung an öffentlichen Referenzdaten (wie OpenDose3D)** – Priorität hoch
  - SNMMI Dosimetry Challenge 2021 (Lu-177-DOTATATE) und das MRTDosimetry-4-Organ-Phantom (Leber, Milz, Nieren, Lebertumor; Aktivität, TIA und Dosis bekannt).
  - OpenDose3D erreicht dort < 3 % Abweichung für Kalibrierung und Organdosis. Das ist der Maßstab für uns.
  - Bezugsquelle und Nutzungsbedingungen der Daten vorher klären; Daten nicht ins Repository.

---

## Umgesetzt (Stand des Plans)

### Grundlage und Methodik

- **Ablauf nach MIRD/EANM:**
  1. Quantitative SPECT mit Kalibrierfaktor: Counts → MBq.
  2. Segmentierung von Organen und Läsionen.
  3. Zeit-Aktivitäts-Kurve erstellen und fitten → zeitintegrierte Aktivität (TIA).
  4. Dosis = TIA × Energie pro Zerfall / Masse.
- **Eingangsdaten:** SPECT-Rekonstruktion des Geräts (OSEM mit CT-Schwächungs-, Streu- und Auflösungskorrektur) in Counts. Die eigene Rekonstruktion der App ist nicht für Dosimetrie gedacht.
- **Nuklide:** Lu-177, Tb-161, I-131, Y-90. Mittlere Energie pro Zerfall nach **ICRP Publication 107** (Summen nach MIRDspecs):

  | Nuklid | Elektronen (keV/Zerfall) | davon β⁻ | Photonen (keV/Zerfall) | Halbwertszeit |
  |---|---|---|---|---|
  | Lu-177 | 147,92 | 133,3 | 35,09 | 6,647 d |
  | Tb-161 | 202,48 | 154,3 | 36,52 | 6,906 d |
  | I-131 | 191,84 | 181,9 | 382,75 | 8,021 d |
  | Y-90 | 933,1 | 932,9 | 0 | 64,1 h |

  Die Halbwertszeiten gelten auch für den Nuklid-Editor im DICOM-Header.

### Funktionen in der App (Bereich „Dosimetrie“ in der linken Seitenleiste)

0. **Zeitpunkt-Übersicht (11/2026)**
   - Automatische Gruppierung der Datensätze zu Aufnahmen über FrameOfReference, Studie und Aufnahmezeit aus dem
     DICOM-Header (`src/dosimetry/sessions.ts`); beim ersten Öffnen ein Zeitpunkt je Aufnahme mit Funktionsbild.
   - Zeitachse (Stunden p.i.) und je Zeitpunkt eine Karte mit Datum, SPECT/PET (Counts/Bq/ml), CT, Organkarte,
     Läsionsbild, Status (t p.i., Dauer, Kalibrierung, registriert) und Plausibilitätswarnungen;
     „Nicht zugeordnet“ für Datensätze ohne Datum; „Im Viewer zeigen“.
   - Viewer: globaler Umschalter SUV | Counts/Bq/ml (die Dosimetrie rechnet immer mit Counts bzw. Bq/ml).

1. **Zeitpunkte**
   - SPECT-Datensätze auswählen, CT je Zeitpunkt; Vorschlag über die FrameOfReference.
   - Zeiten aus dem DICOM-Header, überschreibbar:
     - Aufnahme (0008,0022/0032) minus Injektion (0018,1078);
     - Aktivität (0018,1074);
     - Dauer = Zeit/Projektion × Projektionen × Detektoren;
     - Zerfallskorrektur (0054,1102).
   - Kontrolle: Aktivität im Sichtfeld (MBq, % der injizierten Aktivität).
   - Rigide CT-CT-Registrierung aller Zeitpunkte auf Zeitpunkt 1; SPECT und Labelbilder werden mitbewegt.
   - Vorhandene Organkarten und Labelbilder werden übernommen. Neu segmentiert wird nur nach Rückfrage.
2. **Kalibrierung**
   - Kamera-Profile: Name, cps/MBq, Kollimator, Energiefenster, Recovery-Koeffizienten (Volumen → RC, log-interpoliert).
   - Speicherung im Browser und in der Projektdatei, Import/Export als JSON.
   - MBq = Counts / (Dauer × Faktor) × λT / (1 − e^−λT), Zerfall während der Aufnahme korrigiert.
3. **Regionen**
   - Labelbilder je Zeitpunkt oder für alle Zeitpunkte. Regionen gleichen Namens werden verbunden.
   - Vorauswahl: Nieren, Leber, Milz, Harnblase, Läsionen. RC je Region schaltbar.
   - Masse aus der CT-Dichte: ρ = 1 + HU/1000, oberhalb von Wasser 1 + 0,6·HU/1000.
4. **Kurven und Dosis**
   - Modelle: monoexponentiell, biexponentiell mit Aufnahme, Trapez + Ausläufer, Hänscheid, Madsen.
   - Automatische Modellwahl (AICc ab 5 Punkten); die Auswaschung ist nie langsamer als der physikalische Zerfall.
   - Unsicherheit der TIA aus der Fit-Kovarianz (Delta-Methode).
   - Dosis durch lokale Energiedeposition der Elektronen.
   - BED Nieren für monoexponentielle Auswaschung: α/β = 2,6 Gy, T_rep = 2,8 h (editierbar).
   - Tabelle groß anzeigbar, CSV-Export.
5. **Voxel-Dosiskarte**
   - Auf dem Raster des SPECT von Zeitpunkt 1, alle Zeitpunkte über die Registrierung abgetastet.
   - Integration je Voxel: monoexponentiell (log-linear) oder Trapez + Ausläufer; bei einem Zeitpunkt Hänscheid.
   - Lokale Deposition mit CT-Dichte, oder Faltung mit einer geladenen Kernel-Tabelle („i j k S“, Oktant genügt): FFT, Dichteskalierung ρ_Wasser/ρ.
   - Ergebnis als Datensatz „Dosis (Gy)“. DVH mit D2 %, D50 %, D98 % je Region.

### Module

| Datei | Inhalt |
|---|---|
| `src/dosimetry/nuclideData.ts` | Energien pro Zerfall (ICRP 107), lokale Deposition |
| `src/dosimetry/calibration.ts` | Kamera-Profile, Recovery-Koeffizienten, Zeiten/Dauer aus dem Header, Counts → MBq |
| `src/dosimetry/tacFit.ts` | Kurvenmodelle, Levenberg-Marquardt, AICc, Unsicherheit, Hänscheid/Madsen |
| `src/dosimetry/dose.ts` | Abtastung über Registrierungen, Dichte aus HU, Aktivität/Volumen/Masse je Region |
| `src/dosimetry/voxelDose.ts` | Voxel-TIA, Dosiskarte, Kernel-Parser, FFT-Faltung, DVH |
| `src/dosimetry/setup.ts` | Zustand (in der Projektdatei gespeichert), BED |
| `src/dosimetry/DosimetryPanel.tsx` | Oberfläche |

**Wiederverwendet:**
- Koregistrierung (`src/registration`)
- CT-Organsegmentierung (`src/segmentation`)
- Läsionen (`src/tumor`)
- `Chart` (Kinetik)
- `BigTable`
- Projektdatei
- Nuklidtabelle (`src/header/radionuclide.ts`)

### Verifikation (vorhanden)

- **Unit-Tests** (`src/dosimetry/*.test.ts`):
  - Kalibrierung, Recovery-Koeffizienten, Zeitangaben aus dem Header (auch binäre US-Werte);
  - Fits mit 1–4 Zeitpunkten, Rauschen, Grenze durch den physikalischen Zerfall;
  - Hänscheid/Madsen, Trapez;
  - lokale Deposition (1 GBq Y-90 in 1 kg ≈ 49,7 Gy);
  - Regionsmessung über verschiedene Raster;
  - Voxel-TIA, Kernel-Faltung (Delta- und versetzter Kernel), DVH, BED;
  - ICRP-107-Werte.
- **Browser (11/2026):** Synthetisches DICOM-Phantom mit 3 Aufnahmen (24/48/96 h, je CT + SPECT mit Datum und
  Injektion im Header; Niere T_eff 40 h, Leber 60 h; zwei Läsionen mit Verschiebung und vertauschter Nummerierung):
  automatische Gruppierung, Registrierung, Läsionszuordnung (4 mm / 0 mm), Niere 4,78 Gy (Handrechnung 4,79 Gy),
  Leber-TIA 5190 MBq·h (5194), Voxelkarte und DVH konsistent, Bericht vollständig. Phantom-Kalibrierung:
  10,0 cps/MBq wie vorgegeben.
- **Browser (früher):** Synthetisches Phantom mit 2 Zeitpunkten (24 h / 96 h, T_eff 40 h).
  - Niere: TIA 308 MBq·h, 3,72 Gy – stimmt mit der Handrechnung und der Voxelkarte überein.
  - Organkarte nach der CT-Segmentierung wird automatisch übernommen.

### Quellen

- MIRD-Pamphlet 23 und 26 (quantitative SPECT, Lu-177).
- EANM Dosimetry Committee: Empfehlungen zur Dosimetrie von Lu-177-SSTR- und PSMA-Liganden (2022); Leitfaden zur Unsicherheitsanalyse (2018).
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

### Vergleich mit Recon Studio

| Funktion | OpenDose3D | Recon Studio heute | Empfehlung | Aufwand | Priorität |
|---|---|---|---|---|---|
| Plattform | 3D Slicer, Python, Desktop | Browser, TypeScript, ohne Server | Architektur **nicht** übernehmen; nur Methodik und Daten | – | – |
| Eingangsbilder | SPECT/CT und PET/CT, DICOM | SPECT in Counts (CNTS) | Bq/ml-Bilder (PET, quantitative SPECT) direkt zulassen | S | mittel |
| Kalibrierung | Kalibriermodul aus Phantom oder manuell | Kamera-Profil, Faktor von Hand, RC-Tabelle | Faktor aus Phantom-SPECT berechnen; später RC aus NEMA-Kugeln | S–M | mittel |
| Registrierung | Elastix (rigide/deformierbar) | rigide CT-CT | Deformierbar bleibt offener Punkt; Elastix im Browser nicht verfügbar, eigene Lösung nötig | L | niedrig–mittel |
| Segmentierung | Slicer-Werkzeuge, TotalSegmentator für OAR | TotalSegmentator im Browser, Läsionen, NIfTI-Import | Gleichwertig; nichts übernehmen | – | – |
| Läsionen über Zeitpunkte | manuell bzw. über Registrierung | nur über Namen | Bestehender ToDo (Schwerpunkt-Matching) bleibt | M | mittel |
| Fitmodelle | mono/bi/tri, 11 NUKFIT-Funktionen | mono, bi mit Aufnahme, Trapez, Hänscheid, Madsen | Kein Ausbau auf 11 Funktionen; Akaike-Gewichte anzeigen | S | niedrig |
| Modellwahl | Akaike-Gewichte | Regeln, AICc ab 5 Punkten | Gewichte ergänzen, Regeln beibehalten | S | niedrig |
| Unsicherheit | Fitparameter, Dosis je Segment | TIA aus Fit-Kovarianz | Kalibrierung, RC, Volumen nach EANM 2018 dazunehmen | M | mittel |
| Workflow | Activity (LED) und ADR (LED/CONV/MC je Zeitpunkt) | Activity-Workflow plus voxelweise TIA → Dosis | ADR-Workflow **nicht** übernehmen (lineare Rechnung, gleiches Ergebnis bei gleicher Dichte; nur für MC je Zeitpunkt nötig) | – | – |
| Voxel-Integration | nein, Fit nur auf VOI-Ebene | ja (mono log-linear / Trapez) | Vorteil Recon Studio, beibehalten | – | – |
| LED mit Dichte | ja | ja (ρ aus HU) | Gleichwertig; HU→Dichte-Kurve optional editierbar | S | niedrig |
| DVK-Faltung | FFT, OpenDose-DVKs, Dichtekorrektur | FFT, eigene Tabelle, ρ_Wasser/ρ | **OpenDose-DVK-Import** mit Wahl/Umrechnung der Voxelgröße | M | **hoch** |
| Methodenvergleich | Zwischenergebnisse exportierbar | eine Methode je Lauf | LED und Kernel nebeneinander mit Abweichung je Region | S | mittel |
| Monte Carlo | extern über GATE 9 | keine | **Nicht** übernehmen: GATE/Geant4 im Browser nicht realistisch. Höchstens Export von Aktivitäts- und Dichtekarte (NIfTI/MHD) für externe MC | S (Export) | niedrig |
| Nuklide | ≥ 13 | 4 | Ho-166, Cu-67 nach Bedarf; Diagnostiknuklide (F-18, Ga-68, Tc-99m) unnötig | S je Nuklid | niedrig |
| Organ-S-Werte | MIRD-Schema mit OpenDose-S-Werten | keine | Nur als Gegenprobe; Lizenz der S-Werte unklar, nichts mitliefern | M | niedrig |
| PVE/RC | RC-Kurve, wenn vorhanden | RC-Tabelle im Profil, je Region schaltbar | Gleichwertig | – | – |
| DVH | ja | ja (D2/D50/D98) | Gleichwertig | – | – |
| Bericht | Berichtsmodul | CSV | Bestehenden ToDo „Bericht“ anheben | M | mittel–hoch |
| Validierung | Phantome, SNMMI Challenge, < 3 % | Unit-Tests, synthetisches Phantom | Gleiche Referenzdaten nutzen | M | **hoch** |

### Bewertung

- **Klar lohnend:** OpenDose-DVKs und die Validierung an denselben Referenzdaten. Beides macht die vorhandene Kernel-Faltung erst belastbar, ist im Browser ohne Einschränkung machbar und lizenzrechtlich sauber (Apache 2.0).
- **Lohnend mit kleinem Aufwand:** Bq/ml-Eingang, Kalibrierung aus Phantomaufnahme, LED-gegen-Kernel-Vergleich, Akaike-Gewichte.
- **Nicht übernehmen:**
  - Slicer-/Python-Architektur und GATE-Anbindung. Im Browser nicht machbar, und der Nutzen gegenüber DVK-Faltung ist in Weichteil gering (~1 %).
  - ADR-Workflow als zweiter Hauptweg. Er rechnet das Gleiche in anderer Reihenfolge und bringt ohne MC keinen Gewinn.
  - Alle elf NUKFIT-Funktionen und tri-exponentielle Modelle. Bei 1–4 Zeitpunkten nicht bestimmbar, nur Scheingenauigkeit.
  - Diagnostiknuklide.
- **Hinweis aus der Literatur:** Für I-131 in Lunge und Knochen ist auch die Faltung mit Wasserkernel nur eine Näherung. Die Grenzen im Handbuch (Kapitel 9) sollten das nach Einbau der DVKs ausdrücklich nennen.

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
