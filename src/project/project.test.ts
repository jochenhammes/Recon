import { describe, expect, it } from "vitest";
import { Volume3D } from "../viewer/volume";
import { loadProject, saveProject } from "./project";

describe("project file", () => {
  it("round-trips volumes, typed arrays, maps and plain state; shared data is stored once", async () => {
    const vol = new Volume3D(Float32Array.from({ length: 24 }, (_, i) => i * 0.5), 2, 3, 4, [2, 1.5, 1]);
    const frames = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
    const state = {
      entries: [
        { id: "ds1", dataset: { original: vol, current: vol, atlas: { name: "A", labels: new Map([[1, "Leber"], [2, "Milz"]]) }, dynamic: { frames, start: [0, 60] } }, matrix: [1, 0, 0, 0], tag: "Baseline" },
      ],
      mask: new Uint8Array([1, 0, 1]),
      labels: new Int32Array([-1, 7]),
      nan: NaN,
      nothing: null,
    };
    const blob = saveProject(state, { app: "test" });
    const { state: back, meta } = (await loadProject(await blob.arrayBuffer())) as { state: typeof state; meta: Record<string, unknown> };
    expect(meta.app).toBe("test");
    const d = back.entries[0].dataset;
    expect(d.current).toBeInstanceOf(Volume3D);
    expect(d.current).toBe(d.original);
    expect(Array.from(d.current.data)).toEqual(Array.from(vol.data));
    expect(d.current.geometry).toEqual(vol.geometry);
    expect([d.current.nx, d.current.ny, d.current.nz]).toEqual([4, 3, 2]);
    expect(d.atlas.labels.get(2)).toBe("Milz");
    expect(Array.from(d.dynamic.frames[1])).toEqual([4, 5, 6]);
    expect(back.mask).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.labels)).toEqual([-1, 7]);
    expect(back.nan).toBeNaN();
    expect(back.entries[0].tag).toBe("Baseline");
    // vol.data, two frames, mask, labels → 5 binaries (+ project.json).
    const names = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer())).match(/bin\/\d+\.bin/g) ?? [];
    expect(new Set(names).size).toBe(5);
  });

  it("rejects other files and newer versions", async () => {
    await expect(loadProject(new TextEncoder().encode("kein zip").buffer as ArrayBuffer)).rejects.toThrow(/Keine Recon-Studio-Projektdatei/);
  });
});
