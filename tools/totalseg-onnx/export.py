"""
Exports the TotalSegmentator "total" 3 mm model (nnU-Net v2, Apache-2.0 weights) to ONNX for Recon Studio.

Usage:
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install nnunetv2 onnx onnxruntime numpy
  # weights: https://github.com/wasserth/TotalSegmentator/releases/download/v2.0.0-weights/Dataset297_TotalSegmentator_total_3mm_1559subj.zip
  python export.py <unzipped Dataset297_... folder> <output dir>

Writes model.onnx (fp32), split into ≤ 90 MB parts (model.onnx.part0 …) for static hosting, and model.json with
the preprocessing parameters (spacing, patch size, CT normalization, axis order) and the label table.
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from nnunetv2.training.nnUNetTrainer.nnUNetTrainer import nnUNetTrainer
from nnunetv2.utilities.plans_handling.plans_handler import PlansManager

src = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
folder = next(src.glob("nnUNetTrainer*__nnUNetPlans__3d_fullres"))
plans = json.loads((folder / "plans.json").read_text())
dataset = json.loads((folder / "dataset.json").read_text())
pm = PlansManager(plans)
cm = pm.get_configuration("3d_fullres")
labels = dataset["labels"]
n_classes = len(labels)

net = nnUNetTrainer.build_network_architecture(pm, cm, 1, n_classes, enable_deep_supervision=False)
ckpt = torch.load(folder / "fold_0" / "checkpoint_final.pth", map_location="cpu", weights_only=False)
net.load_state_dict(ckpt["network_weights"])
net.eval()

patch = list(cm.patch_size)
dummy = torch.randn(1, 1, *patch)
onnx_path = out / "model.onnx"
torch.onnx.export(
    net, dummy, onnx_path, input_names=["input"], output_names=["logits"], opset_version=17,
    dynamic_axes=None, do_constant_folding=True, dynamo=False,
)

# Check against PyTorch.
with torch.no_grad():
    ref = net(dummy).numpy()
sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
got = sess.run(None, {"input": dummy.numpy()})[0]
print("max abs diff vs torch:", float(np.abs(ref - got).max()), "argmax agreement:", float((ref.argmax(1) == got.argmax(1)).mean()))

data = onnx_path.read_bytes()
part = 90 * 1024 * 1024
parts = []
for i in range(0, len(data), part):
    name = f"model.onnx.part{len(parts)}"
    (out / name).write_bytes(data[i : i + part])
    parts.append(name)
onnx_path.unlink()

intensity = plans["foreground_intensity_properties_per_channel"]["0"]
meta = {
    "name": "TotalSegmentator total (3 mm, fold 0)",
    "source": "https://github.com/wasserth/TotalSegmentator (Wasserthal et al., Radiology: AI 2023), weights v2.0.0 Dataset297",
    "license": "Apache-2.0",
    "parts": parts,
    "bytes": len(data),
    "sha256": hashlib.sha256(data).hexdigest(),
    "patchSize": patch,  # axis order of the array: (S, A, R) = (z, y, x) of a RAS-aligned grid
    "spacing": cm.spacing,
    "axes": "RAS (array z = superior, y = anterior, x = right)",
    "normalization": {"clip": [intensity["percentile_00_5"], intensity["percentile_99_5"]], "mean": intensity["mean"], "std": intensity["std"]},
    "labels": {str(v): k for k, v in labels.items()},
}
(out / "model.json").write_text(json.dumps(meta, indent=1))
print("written", parts, len(data) / 1e6, "MB")
