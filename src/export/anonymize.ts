import type { DataSet, Element } from "dicom-parser";
import { type TagOverrides, stringValue, tagKey } from "./dicomRewriter";
import { IMPLEMENTATION_CLASS_UID, IMPLEMENTATION_VERSION_NAME } from "./dicomWriter";
import { generateUid } from "./uid";

/**
 * Simplified de-identification based on the DICOM PS3.15 Basic Application Level Confidentiality
 * Profile, with the "Retain Longitudinal Temporal Information" option (dates/times are kept because
 * PET/SPECT quantification needs injection and acquisition times) and optionally "Retain Patient
 * Characteristics" (weight/size/sex/age, needed for SUV).
 *
 * Besides patient data, information about the operating institution, staff, station and the exact
 * device (manufacturer, model, serial numbers, software versions, calibration dates) is removed, and
 * all private elements are dropped since they reveal the vendor and may embed further identifiers.
 *
 * Only top-level elements are inspected. Sequences are removed unless they are on an allow-list of
 * acquisition/geometry sequences that do not carry identifying information.
 */
export interface AnonymizeOptions {
  /** Replacement for PatientName and PatientID. */
  pseudonym: string;
  /** Keep PatientSex/Age/Size/Weight (needed for SUV). */
  retainPatientCharacteristics: boolean;
}

/** Shared per export so that all files of a series get consistent replacement UIDs. */
export interface AnonymizeContext {
  options: AnonymizeOptions;
  uidMap: Map<string, string>;
  /** Replacements for UIDs nested in kept sequences; same length as the original. */
  nestedUidMap: Map<string, string>;
}

export function createAnonymizeContext(options: AnonymizeOptions): AnonymizeContext {
  return { options, uidMap: new Map(), nestedUidMap: new Map() };
}

const tag = tagKey;

/** Type 2 elements: must stay present, emptied. [tag, VR] */
const EMPTY: [string, string][] = [
  [tag(0x0008, 0x0050), "SH"], // AccessionNumber
  [tag(0x0008, 0x0090), "PN"], // ReferringPhysicianName
  [tag(0x0010, 0x0030), "DA"], // PatientBirthDate
  [tag(0x0020, 0x0010), "SH"], // StudyID
  [tag(0x0008, 0x0070), "LO"], // Manufacturer
];

const PATIENT_CHARACTERISTICS: [string, string][] = [
  [tag(0x0010, 0x0040), "CS"], // PatientSex (Type 2 → emptied)
];
const PATIENT_CHARACTERISTICS_REMOVE = [
  tag(0x0010, 0x1010), // PatientAge
  tag(0x0010, 0x1020), // PatientSize
  tag(0x0010, 0x1030), // PatientWeight
];

const REMOVE = [
  tag(0x0002, 0x0016), // SourceApplicationEntityTitle
  tag(0x0008, 0x0014), // InstanceCreatorUID
  tag(0x0008, 0x0080), // InstitutionName
  tag(0x0008, 0x0081), // InstitutionAddress
  tag(0x0008, 0x0092), // ReferringPhysicianAddress
  tag(0x0008, 0x0094), // ReferringPhysicianTelephoneNumbers
  tag(0x0008, 0x1010), // StationName
  tag(0x0008, 0x1040), // InstitutionalDepartmentName
  tag(0x0008, 0x1048), // PhysiciansOfRecord
  tag(0x0008, 0x1050), // PerformingPhysicianName
  tag(0x0008, 0x1060), // NameOfPhysiciansReadingStudy
  tag(0x0008, 0x1070), // OperatorsName
  tag(0x0008, 0x1080), // AdmittingDiagnosesDescription
  tag(0x0010, 0x0021), // IssuerOfPatientID
  tag(0x0010, 0x0032), // PatientBirthTime
  tag(0x0010, 0x0050), // PatientInsurancePlanCodeSequence
  tag(0x0010, 0x1000), // OtherPatientIDs
  tag(0x0010, 0x1001), // OtherPatientNames
  tag(0x0010, 0x1002), // OtherPatientIDsSequence
  tag(0x0010, 0x1005), // PatientBirthName
  tag(0x0010, 0x1040), // PatientAddress
  tag(0x0010, 0x1060), // PatientMotherBirthName
  tag(0x0010, 0x1080), // MilitaryRank
  tag(0x0010, 0x1081), // BranchOfService
  tag(0x0010, 0x1090), // MedicalRecordLocator
  tag(0x0010, 0x2150), // CountryOfResidence
  tag(0x0010, 0x2152), // RegionOfResidence
  tag(0x0010, 0x2154), // PatientTelephoneNumbers
  tag(0x0010, 0x2160), // EthnicGroup
  tag(0x0010, 0x2180), // Occupation
  tag(0x0010, 0x21b0), // AdditionalPatientHistory
  tag(0x0010, 0x21f0), // PatientReligiousPreference
  tag(0x0010, 0x4000), // PatientComments
  tag(0x0008, 0x1030), // StudyDescription
  tag(0x0008, 0x1090), // ManufacturerModelName
  tag(0x0018, 0x1000), // DeviceSerialNumber
  tag(0x0018, 0x1002), // DeviceUID
  tag(0x0018, 0x1004), // PlateID
  tag(0x0018, 0x1007), // CassetteID
  tag(0x0018, 0x1008), // GantryID
  tag(0x0018, 0x1016), // SecondaryCaptureDeviceManufacturer
  tag(0x0018, 0x1018), // SecondaryCaptureDeviceManufacturerModelName
  tag(0x0018, 0x1019), // SecondaryCaptureDeviceSoftwareVersions
  tag(0x0018, 0x1020), // SoftwareVersions
  tag(0x0018, 0x1030), // ProtocolName
  tag(0x0018, 0x1200), // DateOfLastCalibration
  tag(0x0018, 0x1201), // TimeOfLastCalibration
  tag(0x0018, 0x700a), // DetectorID
  tag(0x0018, 0x700c), // DateOfLastDetectorCalibration
  tag(0x0018, 0x700e), // TimeOfLastDetectorCalibration
  tag(0x0020, 0x4000), // ImageComments
  tag(0x0032, 0x1032), // RequestingPhysician
  tag(0x0032, 0x1033), // RequestingService
  tag(0x0032, 0x1060), // RequestedProcedureDescription
  tag(0x0040, 0x0241), // PerformedStationAETitle
  tag(0x0040, 0x0242), // PerformedStationName
  tag(0x0040, 0x0243), // PerformedLocation
  tag(0x0040, 0x0254), // PerformedProcedureStepDescription
  tag(0x0040, 0x0253), // PerformedProcedureStepID
  tag(0x0040, 0x1001), // RequestedProcedureID
  tag(0x0040, 0x2016), // PlacerOrderNumberImagingServiceRequest
  tag(0x0040, 0x2017), // FillerOrderNumberImagingServiceRequest
];

/** UIDs replaced consistently across all files (same original → same replacement). */
const MAPPED_UIDS = [
  tag(0x0020, 0x000d), // StudyInstanceUID
  tag(0x0020, 0x0052), // FrameOfReferenceUID
  tag(0x0020, 0x0200), // SynchronizationFrameOfReferenceUID
];

/** Sequences describing acquisition/geometry/pixel value mapping, kept as-is. */
const KEPT_SEQUENCES = new Set([
  tag(0x0008, 0x2218), // AnatomicRegionSequence
  tag(0x0008, 0x9215), // DerivationCodeSequence
  tag(0x0028, 0x3000), // ModalityLUTSequence
  tag(0x0028, 0x3010), // VOILUTSequence
  tag(0x0040, 0x9096), // RealWorldValueMappingSequence
  tag(0x0054, 0x0012), // EnergyWindowInformationSequence
  tag(0x0054, 0x0013), // EnergyWindowRangeSequence
  tag(0x0054, 0x0016), // RadiopharmaceuticalInformationSequence
  tag(0x0054, 0x0022), // DetectorInformationSequence
  tag(0x0054, 0x0032), // PhaseInformationSequence
  tag(0x0054, 0x0052), // RotationInformationSequence
  tag(0x0054, 0x0062), // GatedInformationSequence
  tag(0x0054, 0x0220), // ViewCodeSequence
  tag(0x0054, 0x0410), // PatientOrientationCodeSequence
  tag(0x0054, 0x0414), // PatientGantryRelationshipCodeSequence
  tag(0x5200, 0x9229), // SharedFunctionalGroupsSequence
  tag(0x5200, 0x9230), // PerFrameFunctionalGroupsSequence
]);

/**
 * Instance UIDs that may appear inside kept sequences (e.g. Radiopharmaceutical Administration Event
 * UID). Vendor UIDs embed an organization root and often the device serial number.
 */
const NESTED_INSTANCE_UIDS = new Set([
  tag(0x0008, 0x0014), // InstanceCreatorUID
  tag(0x0008, 0x0018), // SOPInstanceUID
  tag(0x0008, 0x1155), // ReferencedSOPInstanceUID
  tag(0x0008, 0x1195), // TransactionUID
  tag(0x0008, 0x3012), // RadiopharmaceuticalAdministrationEventUID
  tag(0x0020, 0x000d), // StudyInstanceUID
  tag(0x0020, 0x000e), // SeriesInstanceUID
  tag(0x0020, 0x0052), // FrameOfReferenceUID
  tag(0x0040, 0xa124), // UID
]);
/** UI elements that identify standard definitions, not instances or devices. */
const NON_IDENTIFYING_UIDS = new Set([
  tag(0x0008, 0x0016), // SOPClassUID
  tag(0x0008, 0x010c), // CodingSchemeUID
  tag(0x0008, 0x1150), // ReferencedSOPClassUID
  tag(0x0002, 0x0010), // TransferSyntaxUID
]);

const PATIENT_NAME = tag(0x0010, 0x0010);
const PATIENT_ID = tag(0x0010, 0x0020);

/** Adds de-identification overrides for one file. Call before the export-specific overrides. */
export function addAnonymizationOverrides(dataSet: DataSet, ctx: AnonymizeContext, overrides: TagOverrides): void {
  const { options } = ctx;
  const present = (t: string) => !!dataSet.elements[t];

  for (const el of Object.values(dataSet.elements)) {
    const group = parseInt(el.tag.slice(1, 5), 16);
    if (group % 2 === 1) {
      overrides.set(el.tag, null);
      continue;
    }
    const isSequence = el.vr === "SQ" || el.items !== undefined;
    if (isSequence && !KEPT_SEQUENCES.has(el.tag)) overrides.set(el.tag, null);
    // Any other person name (only detectable in explicit-VR datasets).
    if (el.vr === "PN" && el.tag !== PATIENT_NAME) overrides.set(el.tag, null);
  }

  for (const t of REMOVE) if (present(t)) overrides.set(t, null);
  for (const [t, vr] of EMPTY) if (present(t)) overrides.set(t, { vr, value: new Uint8Array(0) });
  if (!options.retainPatientCharacteristics) {
    for (const [t, vr] of PATIENT_CHARACTERISTICS) if (present(t)) overrides.set(t, { vr, value: new Uint8Array(0) });
    for (const t of PATIENT_CHARACTERISTICS_REMOVE) if (present(t)) overrides.set(t, null);
  }

  const pseudonym = options.pseudonym.trim() || "ANONYM";
  overrides.set(PATIENT_NAME, stringValue("PN", pseudonym.slice(0, 64)));
  overrides.set(PATIENT_ID, stringValue("LO", pseudonym.slice(0, 64)));

  for (const t of MAPPED_UIDS) {
    const original = dataSet.string(t)?.split(String.fromCharCode(0)).join("").trim();
    if (!original) continue;
    let replacement = ctx.uidMap.get(original);
    if (!replacement) {
      replacement = generateUid();
      ctx.uidMap.set(original, replacement);
    }
    overrides.set(t, stringValue("UI", replacement));
  }

  // UIDs nested in kept sequences: overwritten in place with same-length replacements.
  for (const t of KEPT_SEQUENCES) {
    const el = dataSet.elements[t];
    if (!el?.items) continue;
    const patches: { offset: number; bytes: Uint8Array }[] = [];
    collectNestedUidPatches(el.items, ctx, patches);
    if (patches.length > 0) overrides.set(t, { patches });
  }

  // The file is now written by this application: replace the original implementation identifiers
  // in the meta header, which name the vendor's software.
  if (present(tag(0x0002, 0x0012))) overrides.set(tag(0x0002, 0x0012), stringValue("UI", IMPLEMENTATION_CLASS_UID));
  if (present(tag(0x0002, 0x0013))) overrides.set(tag(0x0002, 0x0013), stringValue("SH", IMPLEMENTATION_VERSION_NAME));

  overrides.set(tag(0x0012, 0x0062), stringValue("CS", "YES")); // PatientIdentityRemoved
  overrides.set(
    tag(0x0012, 0x0063), // DeidentificationMethod
    stringValue("LO", options.retainPatientCharacteristics ? "PS3.15 Basic, Retain Dates+Patient Chars, no Device" : "PS3.15 Basic, Retain Dates, no Device"),
  );
}

function collectNestedUidPatches(items: Element[], ctx: AnonymizeContext, patches: { offset: number; bytes: Uint8Array }[]): void {
  for (const it of items) {
    const ds = it.dataSet;
    if (!ds) continue;
    for (const el of Object.values(ds.elements)) {
      if (el.items) {
        collectNestedUidPatches(el.items, ctx, patches);
        continue;
      }
      const isUid = NESTED_INSTANCE_UIDS.has(el.tag) || (el.vr === "UI" && !NON_IDENTIFYING_UIDS.has(el.tag));
      if (!isUid || el.length < 8 || el.length === 0xffffffff) continue;
      const raw = ds.byteArray.subarray(el.dataOffset, el.dataOffset + el.length);
      let original = "";
      for (const b of raw) original += String.fromCharCode(b);
      let replacement = ctx.nestedUidMap.get(original);
      if (!replacement) {
        let textLength = original.length;
        while (textLength > 0 && (original.charCodeAt(textLength - 1) === 0 || original[textLength - 1] === " ")) textLength--;
        replacement = sameLengthUid(textLength).padEnd(original.length, String.fromCharCode(0));
        ctx.nestedUidMap.set(original, replacement);
      }
      const bytes = new Uint8Array(replacement.length);
      for (let i = 0; i < replacement.length; i++) bytes[i] = replacement.charCodeAt(i);
      patches.push({ offset: el.dataOffset, bytes });
    }
  }
}

function randomDigits(n: number, firstMax = 9): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s = String(1 + (buf[0] % firstMax));
  for (let i = 1; i < n; i++) s += String(buf[i] % 10);
  return s;
}

/**
 * A random UID of exactly `length` characters under the 2.25 root (length >= 7). The first arc after
 * 2.25 stays below 2^128; longer UIDs get an additional random arc.
 */
export function sameLengthUid(length: number): string {
  const body = Math.max(length, 7) - 5; // characters after "2.25."
  // A 39-digit arc must start with 1 to stay below 2^128 (≈ 3.4e38).
  if (body <= 39) return `2.25.${randomDigits(body, body === 39 ? 1 : 9)}`;
  // 38-digit first arc, then "." and at least one more digit.
  return `2.25.${randomDigits(38)}.${randomDigits(body - 39)}`;
}
