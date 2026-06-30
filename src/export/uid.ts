/**
 * Generates a fresh DICOM UID under the "2.25" UUID-derived root (DICOM PS3.5 Annex B),
 * which requires no registration: 2.25.<decimal representation of a random UUID's 128 bits>.
 */
export function generateUid(): string {
  const hex = crypto.randomUUID().replace(/-/g, "");
  const decimal = BigInt(`0x${hex}`).toString(10);
  return `2.25.${decimal}`;
}
