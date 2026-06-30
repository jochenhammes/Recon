/** A single acquired projection frame from one of the (up to two) detector heads. */
export interface ProjectionFrame {
  /** Detector head index, 0-based (0 = first head, 1 = second head). */
  detector: number;
  /** Absolute projection angle in degrees, 0-360, measured in the acquisition's own convention. */
  angleDeg: number;
  /** Row-major pixel data for this frame, length rows*cols. */
  pixels: Float32Array;
}

/** A parsed SPECT raw-data (multi-frame NM DICOM) acquisition. */
export interface SpectProjectionSet {
  /** Number of rows per frame (axial/slice direction). */
  rows: number;
  /** Number of columns per frame (transaxial direction). */
  cols: number;
  /** Pixel spacing [row spacing mm, column spacing mm], if present in the file. */
  pixelSpacingMm: [number, number];
  /** Number of distinct detector heads found (1 or 2). */
  numDetectors: number;
  /** All frames, in file order (not necessarily angle-sorted). */
  frames: ProjectionFrame[];
  /** Free-text summary fields for display purposes. */
  meta: {
    patientId?: string;
    studyDate?: string;
    manufacturer?: string;
    radionuclide?: string;
    sourceFileName: string;
  };
}
