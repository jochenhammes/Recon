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
reference_net = __import__("copy").deepcopy(net)


class ShuffleUp3d(torch.nn.Module):
    """ConvTranspose3d with kernel = stride = 2 as 1×1×1 Conv to 8·C_out channels plus a 3D pixel shuffle.

    ONNX Runtime's WebGPU backend only implements 2-D ConvTranspose; Conv (3-D), Reshape and Transpose
    (rank ≤ 6) are supported, so this form runs on the GPU. Mathematically identical (non-overlapping blocks).
    """

    def __init__(self, ct: torch.nn.ConvTranspose3d):
        super().__init__()
        assert tuple(ct.kernel_size) == (2, 2, 2) and tuple(ct.stride) == (2, 2, 2) and ct.groups == 1
        cin, cout = ct.in_channels, ct.out_channels
        self.cout = cout
        self.conv = torch.nn.Conv3d(cin, cout * 8, 1, bias=ct.bias is not None)
        w = ct.weight.data  # (cin, cout, a, b, c)
        self.conv.weight.data = w.permute(1, 2, 3, 4, 0).reshape(cout * 8, cin, 1, 1, 1).clone()
        if ct.bias is not None:
            self.conv.bias.data = ct.bias.data.repeat_interleave(8).clone()

    def forward(self, x):
        y = self.conv(x)  # (n, cout·(a,b,c), d, h, w)
        n, _, d, h, w = y.shape
        o = self.cout
        # Unfold one axis at a time so that no tensor exceeds rank 6.
        y = y.reshape(n, o * 4, 2, d, h, w).permute(0, 1, 3, 4, 5, 2).reshape(n, o * 4, d, h, w * 2)  # c → w
        y = y.reshape(n, o * 2, 2, d, h, w * 2).permute(0, 1, 3, 4, 2, 5).reshape(n, o * 2, d, h * 2, w * 2)  # b → h
        y = y.reshape(n, o, 2, d, h * 2, w * 2).permute(0, 1, 3, 2, 4, 5).reshape(n, o, d * 2, h * 2, w * 2)  # a → d
        return y


def replace_transposed(module: torch.nn.Module) -> int:
    count = 0
    for name, child in module.named_children():
        if isinstance(child, torch.nn.ConvTranspose3d):
            setattr(module, name, ShuffleUp3d(child))
            count += 1
        else:
            count += replace_transposed(child)
    return count


print("replaced ConvTranspose3d:", replace_transposed(net))

patch = list(cm.patch_size)
dummy = torch.randn(1, 1, *patch)
onnx_path = out / "model.onnx"
torch.onnx.export(
    net, dummy, onnx_path, input_names=["input"], output_names=["logits"], opset_version=17,
    dynamic_axes=None, do_constant_folding=True, dynamo=False,
)

# Check against PyTorch.
with torch.no_grad():
    ref = reference_net(dummy).numpy()
    print("max abs diff rewritten vs original torch:", float(np.abs(net(dummy).numpy() - ref).max()))
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
