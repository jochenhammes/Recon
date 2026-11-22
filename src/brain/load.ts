import { parseLabelTable } from "../atlas/atlas";
import type { LoadedDataset } from "../dataset/types";
import { createDataset } from "../dataset/types";
import { fetchNifti, maskFromBase } from "../normalization/templates";
import type { BundledEntry } from "./catalog";

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

async function fetchText(path: string): Promise<string> {
  const r = await fetch(url(path));
  if (!r.ok) throw new Error(`„${path}“ konnte nicht geladen werden (${r.status}).`);
  return r.text();
}

/**
 * Loads a bundled catalogue entry as dataset: templates with their brain mask (T1/T2: mask file; PET/SPECT: from
 * the image; CT: none, the whole head is matched), atlases with their label table, probability maps as is.
 */
export async function loadBundledEntry(e: BundledEntry): Promise<LoadedDataset> {
  const fileName = e.file.split("/").pop()!;
  const [img, mask, table] = await Promise.all([
    fetchNifti(url(e.file)),
    e.mask ? fetchNifti(url(e.mask)) : Promise.resolve(undefined),
    e.table ? fetchText(e.table) : Promise.resolve(undefined),
  ]);
  const d = { ...createDataset(img.volume, { kind: "nifti", fileName, nifti: img.nifti }, e.name), catalogId: e.id };
  if (e.group === "atlas") return { ...d, atlas: { name: e.name, labels: parseLabelTable(table ?? ""), attribution: e.attribution } };
  if (e.templateKind) {
    let m: Float32Array | null = null;
    if (mask) m = Float32Array.from(mask.volume.data, (v) => (v > 0.5 ? 1 : 0));
    else if (e.templateKind !== "CT") m = maskFromBase(img.volume.data);
    return { ...d, template: { name: e.name, kind: e.templateKind, mask: m, attribution: e.attribution } };
  }
  return { ...d, valueUnit: e.group === "tpm" ? "p" : undefined };
}
