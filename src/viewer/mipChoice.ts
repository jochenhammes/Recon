/** A dataset that could be shown in the MIP view. */
export interface MipCandidate {
  id: string;
  /** DICOM modality code (PT, NM, CT, MR …) or "SPECT" for own reconstructions. */
  modality: string;
  /** Label images and templates are never chosen automatically. */
  excluded?: boolean;
}

const PRIORITY: string[][] = [["PT"], ["NM", "SPECT"], ["CT"]];

/**
 * Automatic MIP dataset: PET before SPECT before CT; candidates are in display order (shown ones first),
 * so among several PETs the shown/top one wins. Falls back to `fallbackId` (the base).
 */
export function autoMipId(candidates: MipCandidate[], fallbackId: string | undefined): string | undefined {
  for (const group of PRIORITY) {
    const hit = candidates.find((c) => !c.excluded && group.includes(c.modality));
    if (hit) return hit.id;
  }
  return fallbackId;
}
