import { voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4, type Mat4, transformedWorldToVoxel } from "../core/transform";
import { type Normalization, fieldFromAffine, pullbackPositions } from "../normalization/model";
import { DEFAULT_WARP, type WarpOptions, estimateWarp } from "../normalization/warp";
import { type CoregImage, coregister } from "../registration/coregister";
import { resampleAtPoints } from "../resample/resample";
import { Volume3D } from "../viewer/volume";
import { type CentiloidCalibration, type CentiloidResult, centiloidFromMeans } from "./centiloid";
import { type CentiloidVois, voiMeans } from "./vois";

/**
 * Synchronous Centiloid pipeline (same steps as the app, without workers) for scripts and tests:
 * PET → T1 rigid (NMI), T1 → template affine (NCC, brain mask) + nonlinear, PET resampled through both
 * into the template grid, VOI means → SUVR → CL. Without T1 the PET is normalized directly to a PET template.
 */
export interface PipelineInput {
  pet: Volume3D;
  t1?: Volume3D;
  template: Volume3D;
  templateMask?: Float32Array;
  /** Adaptive template components (PET-only). */
  templateComponents?: Float32Array[];
  vois: CentiloidVois;
  calibration: CentiloidCalibration;
  warp?: Partial<WarpOptions> | false;
  onStage?: (stage: string) => void;
}

export interface PipelineOutput {
  result: CentiloidResult;
  normalization: Normalization;
  /** PET → T1 world (identity without T1). */
  petToSubject: Mat4;
  petStd: Volume3D;
  subjectStd: Volume3D;
  componentWeights: number[];
}

/**
 * Robust affine normalization in two stages (as SPM/FSL do in spirit): whole head with NMI and coarse
 * search for a wide capture range, then refinement restricted to the template brain mask with the
 * contrast-appropriate cost. A brain-masked cost alone has too narrow a basin for real head MRIs.
 */
export function affineToTemplate(template: CoregImage, subject: CoregImage, mask: Float32Array | undefined, cost: "ncc" | "nmi") {
  const rough = coregister(template, subject, { dof: 12, cost: "nmi", levels: [8, 4], coarseSearch: true, initial: IDENTITY_MAT4 });
  if (!mask) return coregister(template, subject, { dof: 12, cost, levels: [4, 2], coarseSearch: false, initial: rough.matrix });
  const fine = coregister(template, subject, { dof: 12, cost, levels: [4, 2], coarseSearch: false, initial: rough.matrix, fixedMask: mask });
  return { ...fine, before: rough.before };
}

const img = (v: Volume3D): CoregImage => ({ data: v.data, dims: [v.nx, v.ny, v.nz], geometry: v.geometry });

function onGrid(src: Volume3D, n: Normalization, toSubject: Mat4): Volume3D {
  const points = pullbackPositions(n, IDENTITY_MAT4);
  // points are subject positions; the source lives in its own world: subject = toSubject · source.
  const w2v = transformedWorldToVoxel(worldToVoxelTransform(src.geometry), toSubject);
  const data = resampleAtPoints(src, w2v, points, "linear");
  const { nx, ny, nz, geometry } = n.grid;
  return new Volume3D(data, nz, ny, nx, [geometry.spacing[2], geometry.spacing[1], geometry.spacing[0]], geometry);
}

export function runCentiloidPipeline(input: PipelineInput): PipelineOutput {
  const { pet, t1, template } = input;
  const subject = t1 ?? pet;
  let petToSubject: Mat4 = IDENTITY_MAT4;
  if (t1) {
    input.onStage?.("PET → T1");
    petToSubject = coregister(img(t1), img(pet), { dof: 6, cost: "nmi", levels: [8, 4, 2], coarseSearch: true, initial: IDENTITY_MAT4 }).matrix;
  }
  input.onStage?.("affin");
  const aff = affineToTemplate(img(template), img(subject), input.templateMask, "ncc");
  const grid = { nx: template.nx, ny: template.ny, nz: template.nz, geometry: template.geometry };
  let componentWeights: number[] = [];
  let n: Normalization = { subjectId: "subject", templateName: "template", grid, affine: aff.matrix, field: fieldFromAffine(grid, aff.matrix), kind: "affine" };
  if (input.warp !== false) {
    input.onStage?.("nichtlinear");
    const w = estimateWarp(
      { template: img(template), subject: img(subject), affine: aff.matrix, weights: input.templateMask, components: input.templateComponents },
      { ...DEFAULT_WARP, ...(input.warp ?? {}) },
    );
    n = { ...n, field: w.field, kind: "nonlinear", warp: { foldedFraction: w.foldedFraction, maxDisplacementMm: w.maxDisplacementMm, costBefore: w.costBefore, costAfter: w.costAfter } };
    componentWeights = w.componentWeights;
  }
  const petStd = onGrid(pet, n, petToSubject);
  const subjectStd = onGrid(subject, n, IDENTITY_MAT4);
  const result = centiloidFromMeans(voiMeans(petStd, input.vois), input.calibration);
  return { result, normalization: n, petToSubject, petStd, subjectStd, componentWeights };
}

/** Pearson correlation of two volumes on the same grid inside a mask (quality measure of a normalization). */
export function maskedCorrelation(a: Float32Array, b: Float32Array, mask?: Float32Array): number {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !(mask[i] > 0.5)) continue;
    const x = a[i], y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++;
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
}

/** World position of a voxel center (re-exported convenience for scripts). */
export const worldOf = voxelToWorld;
