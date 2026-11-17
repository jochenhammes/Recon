import { type Vec3, type WorldToVoxel, voxelToWorld } from "../core/geometry";
import { resampleInto } from "../resample/resample";
import type { Volume3D } from "../viewer/volume";
import type { VoxelGrid } from "../viewer/types";
import type { Lesion } from "./segment";

/**
 * Coupling of CT organ labels (TotalSegmentator names) with the PET lesion segmentation: physiological
 * uptake, anatomical location, liver reference.
 */

/** Organs with physiological uptake excluded by default per indication. */
export const EXCLUSION_PRESETS: Record<"lymphoma" | "psma", string[]> = {
  // FDG: brain, myocardium, urinary tract.
  lymphoma: ["brain", "heart", "kidney_left", "kidney_right", "urinary_bladder"],
  // PSMA: kidneys, bladder, liver, spleen, bowel (salivary/lacrimal glands are not in the CT model).
  psma: ["kidney_left", "kidney_right", "urinary_bladder", "liver", "spleen", "small_bowel", "duodenum", "colon", "stomach"],
};

const BONE = /^(vertebrae|rib|hip|sacrum|femur|humerus|scapula|clavicula|skull|sternum|costal_cartilages)/;

export function isBone(labelName: string): boolean {
  return BONE.test(labelName.replace(/ /g, "_"));
}

/** Organ label (nearest neighbour) for every voxel of `target`; `w2v` maps the target's own world to label voxels. */
export function organsOnGrid(labels: VoxelGrid, w2v: WorldToVoxel, target: Volume3D): Uint8Array {
  const v = resampleInto(labels, w2v, { nx: target.nx, ny: target.ny, nz: target.nz, geometry: target.geometry }, "nearest");
  const out = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = Number.isFinite(v[i]) ? Math.max(0, Math.min(255, Math.round(v[i]))) : 0;
  return out;
}

const norm = (s: string) => s.replace(/ /g, "_");

/**
 * Annotates lesions with their dominant organ (> 50 % of the voxels) and bone location, and excludes
 * lesions lying mainly in organs with physiological uptake. Manual decisions in `keepManual` stay.
 */
export function annotateLesions(
  lesions: Lesion[],
  lesionLabels: Int32Array,
  organs: Uint8Array,
  names: Map<number, string>,
  exclude: Set<string>,
  fraction = 0.5,
): Lesion[] {
  const counts = new Map<number, Map<number, number>>();
  for (let i = 0; i < lesionLabels.length; i++) {
    const id = lesionLabels[i];
    if (!id) continue;
    let m = counts.get(id);
    if (!m) counts.set(id, (m = new Map()));
    const o = organs[i];
    m.set(o, (m.get(o) ?? 0) + 1);
  }
  return lesions.map((l) => {
    const m = counts.get(l.id);
    if (!m) return l;
    let best = 0, bestN = 0, total = 0, bone = 0, excluded = 0;
    for (const [o, n] of m) {
      total += n;
      const name = norm(names.get(o) ?? "");
      if (o && n > bestN) {
        best = o;
        bestN = n;
      }
      if (o && isBone(name)) bone += n;
      if (o && exclude.has(name)) excluded += n;
    }
    const organ = best && bestN / total > fraction ? (names.get(best) ?? "") : "";
    const isExcluded = excluded / total > fraction;
    return {
      ...l,
      organ,
      bone: bone / total > fraction,
      included: isExcluded ? false : l.included,
      note: isExcluded ? `physiologisch (${organ || "Ausschlussorgan"})` : l.note,
    };
  });
}

/**
 * Center (world, own coordinates of the label grid) of a 3 cm liver reference sphere: inside the liver
 * eroded by the sphere radius, centroid of the right half of that interior (right lobe), snapped to the
 * nearest interior voxel. Null if the liver is too small.
 */
export function autoLiverCenter(labels: Volume3D, liverId: number, radiusMm = 15): Vec3 | null {
  const { nx, ny, nz, data } = labels;
  const s = labels.geometry.spacing;
  const r = [0, 1, 2].map((a) => Math.ceil(radiusMm / s[a]));
  const isLiver = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && data[(k * ny + j) * nx + i] === liverId;
  // Erosion by a box test along the axes and diagonals (fast approximation of the sphere).
  const interior: Vec3[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!isLiver(i, j, k)) continue;
        let ok = true;
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0.7, -0.7, 0], [-0.7, -0.7, 0], [0.7, 0, 0.7], [-0.7, 0, -0.7], [0, 0.7, 0.7], [0, -0.7, -0.7]])
          if (!isLiver(Math.round(i + di * r[0]), Math.round(j + dj * r[1]), Math.round(k + dk * r[2]))) {
            ok = false;
            break;
          }
        if (ok) interior.push(voxelToWorld(labels.geometry, i, j, k));
      }
  if (!interior.length) return null;
  // Right lobe: patient right = smaller LPS x.
  const cx = interior.reduce((a, p) => a + p[0], 0) / interior.length;
  const right = interior.filter((p) => p[0] <= cx);
  const pick = right.length ? right : interior;
  const c: Vec3 = [0, 1, 2].map((a) => pick.reduce((s2, p) => s2 + p[a], 0) / pick.length) as Vec3;
  let best = pick[0], bd = Infinity;
  for (const p of pick) {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
