/**
 * Patient ID prefix for exported files: when set (Daten → Patient-ID), every exported NIfTI and CSV file – and
 * ZIP archives of such files – starts with "<ID>_".
 */
let patientId = "";

/** Characters that are not allowed or awkward in file names are replaced by "_". */
export function sanitizePatientId(id: string): string {
  return id
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|_+$/g, "");
}

export function setExportPatientId(id: string): void {
  patientId = sanitizePatientId(id);
}

export function getExportPatientId(): string {
  return patientId;
}

/** Adds the patient ID to NIfTI/CSV file names (and ZIPs of them with `archive`); other names are unchanged. */
export function withPatientId(name: string, opts: { archive?: boolean } = {}): string {
  if (!patientId) return name;
  const slash = name.lastIndexOf("/");
  const dir = name.slice(0, slash + 1);
  const file = name.slice(slash + 1);
  const eligible = /\.(nii|nii\.gz|csv)$/i.test(file) || (opts.archive && /\.zip$/i.test(file));
  if (!eligible || file.startsWith(`${patientId}_`)) return name;
  return `${dir}${patientId}_${file}`;
}
