import { describe, expect, it } from "vitest";
import { buildNiftiFile } from "../export/niftiWriter";
import { Volume3D } from "../viewer/volume";
import { loadVolumesFromFiles } from "../viewer/volumeLoader";
import { niftiLabelInfo, parseXmlLabelTable } from "./labelNifti";

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]];
const labelVol = () => new Volume3D(Float32Array.from({ length: 4 * 4 * 3 }, (_, i) => i % 4), 3, 4, 4, [2, 2, 2], { origin: [0, 0, 0], axes, spacing: [2, 2, 2] });

describe("label atlases in NIfTI", () => {
  it("export → reload keeps the atlas with region names", async () => {
    const atlas = { name: "CT-Organe", labels: new Map([[1, "spleen"], [2, "kidney_right"], [3, "liver"]]), attribution: "TotalSegmentator" };
    const bytes = buildNiftiFile(labelVol(), { atlas });
    expect(niftiLabelInfo(bytes.subarray(0, 352 + 200))?.intentLabel).toBe(true);
    const { items } = await loadVolumesFromFiles([new File([bytes], "export.nii")]);
    const a = items[0].loaded.atlas!;
    expect(a.name).toBe("CT-Organe");
    expect(a.attribution).toBe("TotalSegmentator");
    expect([...a.labels]).toEqual([[1, "spleen"], [2, "kidney_right"], [3, "liver"]]);
    expect(items[0].loaded.volume.data[3]).toBe(3);
  });

  it("plain images stay plain; label-named integer images and accompanying tables become atlases", async () => {
    const plain = buildNiftiFile(labelVol());
    expect((await loadVolumesFromFiles([new File([plain], "pet.nii")])).items[0].loaded.atlas).toBeUndefined();
    const named = (await loadVolumesFromFiles([new File([plain], "sub-01_dseg.nii")])).items[0].loaded.atlas!;
    expect(named.labels.get(2)).toBe("Region 2");
    const r = await loadVolumesFromFiles([new File([plain], "AAL3v1.nii"), new File(["1 Precentral_L 2001\n2 Precentral_R 2002\n3 Frontal_Sup_2_L 2101\n"], "AAL3v1.nii.txt")]);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toHaveLength(0);
    expect(r.items[0].loaded.atlas!.labels.get(3)).toBe("Frontal_Sup_2_L");
  });

  it("reads the Caret XML label table (TotalSegmentator output)", () => {
    const xml = '<CaretExtension><LabelTable>\n<Label Key="1" Red="0" Green="1" Blue="0" Alpha="1"><![CDATA[spleen]]></Label>\n<Label Key="5" Red="1"><![CDATA[liver]]></Label></LabelTable></CaretExtension>';
    expect([...parseXmlLabelTable(xml)]).toEqual([[1, "spleen"], [5, "liver"]]);
  });
});
