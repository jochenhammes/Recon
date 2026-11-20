# Dosimetrie – offene Punkte und Umsetzungsstand

Sammlung für den Bereich **Dosimetrie** (Therapie-Dosimetrie aus SPECT/CT). Benutzerdoku: [MANUAL.md, Kapitel 8a](MANUAL.md#8a-dosimetrie-spectct).
Forschungswerkzeug, kein zertifiziertes Medizinprodukt.

---

## Offene Punkte

### Funktionen

- [ ] **Läsionen über Zeitpunkte zuordnen (Schwerpunkt-Matching)**
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
- [ ] **Rechnung im Web Worker**
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
- [ ] **FrameOfReference bei DICOM ohne Positionsangaben**
  - Fehlen Image Position/Orientation, geht beim Laden auch die FrameOfReference verloren (`buildDicomVolume` in `src/viewer/volumeLoader.ts`).
  - Das CT wird dann nicht automatisch dem Zeitpunkt zugeordnet.
  - **Vorschlag:** FrameOfReference auch in die Ersatz-Geometrie übernehmen.
- [ ] **Bericht**: Zusammenfassung pro Patient (Tabelle, Kurven, DVH, Parameter, Quellen) als PDF/HTML zusätzlich zur CSV.

### Prüfung und Validierung

- [ ] Registrierung der Zeitpunkte an echten SPECT/CT-Daten im Browser prüfen. Dazu gehört das Zusammenspiel mehrerer CTs, der Organkarten und der Mitbewegung von SPECT und Labelbildern.
- [ ] Phantommessung (NEMA-Kugeln) mit eigenem Kalibrierfaktor: Kalibrierung und Recovery-Koeffizienten prüfen.
- [ ] Vergleich mit OpenDose3D (3D Slicer) an einem Patientendatensatz (nicht ins Repository).
- [ ] Kernel-Faltung mit einer echten Voxel-S-Wert-Tabelle (z. B. Lanconelli 2012 für Lu-177 / I-131 / Y-90) prüfen. Lizenz für eine eventuelle Weitergabe im Repository klären.

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
- **Browser:** Synthetisches Phantom mit 2 Zeitpunkten (24 h / 96 h, T_eff 40 h).
  - Niere: TIA 308 MBq·h, 3,72 Gy – stimmt mit der Handrechnung und der Voxelkarte überein.
  - Organkarte nach der CT-Segmentierung wird automatisch übernommen.

### Quellen

- MIRD-Pamphlet 23 und 26 (quantitative SPECT, Lu-177).
- EANM Dosimetry Committee: Empfehlungen zur Dosimetrie von Lu-177-SSTR- und PSMA-Liganden (2022); Leitfaden zur Unsicherheitsanalyse (2018).
- Hänscheid et al., Madsen et al.: Ein-Zeitpunkt-Dosimetrie.
- Sarrut et al.: voxelweise Modellwahl (VoMM).
- Lanconelli et al., Phys Med Biol 2012: Voxel-S-Werte.
- ICRP Publication 107 (Eckerman & Endo 2008): Zerfallsdaten.
