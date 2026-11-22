import type { LoadedDataset } from "../dataset/types";

/**
 * Text hints on the tracer of a dataset for choosing the template: radiopharmaceutical and its code meaning
 * (DICOM 0054,0016), series and study description, and the file/display name.
 */
export function tracerHint(d: Pick<LoadedDataset, "source" | "displayName">): string {
  const parts: string[] = [d.displayName];
  const src = d.source;
  if (src.kind === "dicom") {
    const ds = src.files[0].dataSet;
    const rp = ds.elements["x00540016"]?.items?.[0]?.dataSet;
    parts.push(rp?.string("x00180031") ?? "", rp?.elements["x00540304"]?.items?.[0]?.dataSet?.string("x00080104") ?? "", ds.string("x0008103e") ?? "", ds.string("x00081030") ?? "");
  } else if ("fileName" in src && typeof src.fileName === "string") parts.push(src.fileName);
  return parts.filter(Boolean).join(" ");
}
