"""
Exports the MONAI "wholeBody_ct_segmentation" bundle (SegResNet, 104 TotalSegmentator-v1 structures, Apache-2.0)
in its 3 mm variant (models/model_lowres.pt) to ONNX for Recon Studio.

Usage:
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install monai onnx onnxruntime numpy
  # bundle files from https://huggingface.co/MONAI/wholeBody_ct_segmentation:
  #   configs/inference.json, configs/metadata.json, models/model_lowres.pt, LICENSE
  python export_monai_segresnet.py <bundle dir> <output dir>

Changes for onnxruntime-web (WebGPU), mathematically identical to the original:
  - trilinear ×2 upsampling (align_corners=False) as pad/slice/weighted sum/interleave per axis
    (no 5-D Resize needed);
  - the final 105-class 1×1×1 convolution returns the top-3 classes and probabilities per voxel
    (same head as the TotalSegmentator export) instead of all logits.
Writes model.onnx parts (≤ 90 MB) and model.json (spacing, patch, normalization, labels).
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from monai.networks.nets import SegResNet

src = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
cfg = json.loads((src / "configs" / "inference.json").read_text())
meta = json.loads((src / "configs" / "metadata.json").read_text())
nd = cfg["network_def"]
labels = meta["network_data_format"]["outputs"]["pred"]["channel_def"]
n_classes = nd["out_channels"]
net = SegResNet(
    spatial_dims=3, in_channels=1, out_channels=n_classes, init_filters=nd["init_filters"], blocks_down=nd["blocks_down"], blocks_up=nd["blocks_up"]
)
sd = torch.load(src / "models" / "model_lowres.pt", map_location="cpu", weights_only=False)
print(net.load_state_dict(sd.get("state_dict", sd)))
net.eval()
reference_net = __import__("copy").deepcopy(net)


class Upsample2x(torch.nn.Module):
    """Trilinear ×2 upsampling with align_corners=False, separable per axis:
    out[2i] = 0.75·x[i] + 0.25·x[i−1], out[2i+1] = 0.75·x[i] + 0.25·x[i+1] (edges replicated)."""

    @staticmethod
    def axis(x, dim):
        n = x.shape[dim]
        prev = torch.cat([x.narrow(dim, 0, 1), x.narrow(dim, 0, n - 1)], dim)
        nxt = torch.cat([x.narrow(dim, 1, n - 1), x.narrow(dim, n - 1, 1)], dim)
        even = 0.75 * x + 0.25 * prev
        odd = 0.75 * x + 0.25 * nxt
        y = torch.stack([even, odd], dim + 1)  # … n, 2 …
        shape = list(x.shape)
        shape[dim] = 2 * n
        return y.reshape(shape)

    def forward(self, x):
        for d in (2, 3, 4):
            x = self.axis(x, d)
        return x


def replace_upsample(module: torch.nn.Module) -> int:
    count = 0
    for name, child in module.named_children():
        if isinstance(child, torch.nn.Upsample):
            assert child.mode == "trilinear" and tuple(child.scale_factor) == (2.0, 2.0, 2.0) and not child.align_corners
            setattr(module, name, Upsample2x())
            count += 1
        else:
            count += replace_upsample(child)
    return count


print("replaced trilinear upsampling:", replace_upsample(net))
TOPK = 3


class TopKHead(torch.nn.Module):
    """Top-3 classes and probabilities per voxel, the 1×1×1 classifier evaluated in class blocks (as in the
    TotalSegmentator export): output (1, 2·TOPK, D, H, W) = [class₁, p₁, class₂, p₂, class₃, p₃]."""

    BLOCK = 15

    def __init__(self, net, classes):
        super().__init__()
        seg = net.conv_final[2].conv
        net.conv_final[2] = torch.nn.Identity()
        self.net = net
        self.blocks = torch.nn.ModuleList()
        self.offsets = []
        for a in range(0, classes, self.BLOCK):
            b = min(classes, a + self.BLOCK)
            conv = torch.nn.Conv3d(seg.in_channels, b - a, 1)
            conv.weight.data = seg.weight.data[a:b].clone()
            conv.bias.data = seg.bias.data[a:b].clone()
            self.blocks.append(conv)
            self.offsets.append(a)
            self.register_buffer(f"cls{a}", torch.arange(a, b, dtype=torch.float32).view(1, b - a, 1, 1, 1))

    @staticmethod
    def _topk(values, labels):
        vals, idxs = [], []
        cur = values
        for _ in range(TOPK):
            m = cur.amax(1, keepdim=True)
            eq = cur == m
            vals.append(m)
            idxs.append(torch.where(eq, labels, torch.tensor(-1.0)).amax(1, keepdim=True))
            cur = torch.where(eq, torch.tensor(-1e9), cur)
        return vals, idxs

    def forward(self, x):
        feat = self.net(x)
        run_v = run_i = lse = None
        for conv, a in zip(self.blocks, self.offsets):
            src = feat if run_v is None else feat + 0.0 * (run_v[-1] + run_i[-1] + lse)[:, :, :1, :1, :1]
            logits = conv(src)
            m = logits.amax(1, keepdim=True)
            block_lse = m + torch.log(torch.exp(logits - m).sum(1, keepdim=True))
            v, i = self._topk(logits, getattr(self, f"cls{a}"))
            if run_v is None:
                run_v, run_i, lse = v, i, block_lse
            else:
                mx = torch.where(lse > block_lse, lse, block_lse)
                lse = mx + torch.log(torch.exp(lse - mx) + torch.exp(block_lse - mx))
                vv, ii = self._topk(torch.cat(run_v + v, 1), torch.cat(run_i + i, 1))
                run_v, run_i = vv, ii
        outs = []
        for v, i in zip(run_v, run_i):
            outs += [i, torch.exp(v - lse)]
        return torch.cat(outs, 1)


head = TopKHead(net, n_classes).eval()
patch = cfg["inferer"]["roi_size"]
dummy = torch.randn(1, 1, *patch)
onnx_path = out / "model.onnx"
torch.onnx.export(head, dummy, onnx_path, input_names=["input"], output_names=["logits"], opset_version=17, dynamic_axes=None, do_constant_folding=True, dynamo=False)

with torch.no_grad():
    ref_logits = reference_net(dummy)
    ref = head(dummy).numpy()
    p_ref = torch.softmax(ref_logits, 1).amax(1)[0].numpy()
    print("max abs diff of top-1 probability vs original softmax:", float(np.abs(ref[0, 1] - p_ref).max()))
    print("top-1 agreement with original argmax:", float((ref[0, 0] == ref_logits.argmax(1)[0].numpy()).mean()))
sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
got = sess.run(None, {"input": dummy.numpy()})[0]
print("max abs diff vs torch:", float(np.abs(ref - got).max()), "top-1 agreement:", float((ref[0, 0] == got[0, 0]).mean()))

data = onnx_path.read_bytes()
part = 90 * 1024 * 1024
parts = []
for i in range(0, len(data), part):
    name = f"model.onnx.part{len(parts)}"
    (out / name).write_bytes(data[i : i + part])
    parts.append(name)
onnx_path.unlink()

model = {
    "name": "MONAI wholeBody CT SegResNet (3 mm)",
    "source": "https://huggingface.co/MONAI/wholeBody_ct_segmentation (MONAI Model Zoo, bundle " + meta.get("version", "?") + ", model_lowres.pt; trained on TotalSegmentator v1 data)",
    "license": "Apache-2.0",
    "parts": parts,
    "bytes": len(data),
    "sha256": hashlib.sha256(data).hexdigest(),
    # MONAI array order after Orientationd(RAS) is (x, y, z); Recon Studio feeds (z, y, x) patches, the cube is symmetric.
    "patchSize": [patch[2], patch[1], patch[0]],
    "spacing": [3.0, 3.0, 3.0],
    "axes": "RAS (array z = superior, y = anterior, x = right)",
    "axisOrder": "xyz",
    "normalization": {"kind": "monai", "nonzero": True, "scaleTo": [-1.0, 1.0]},
    "overlap": cfg.get("displayable_configs", {}).get("sw_overlap", 0.25),
    "labels": {str(k): v for k, v in labels.items()},
    "output": {"kind": "topk", "k": TOPK},
}
(out / "model.json").write_text(json.dumps(model, indent=1, ensure_ascii=False))
(out / "NOTICE.txt").write_text(
    "MONAI wholeBody_ct_segmentation (SegResNet, 3 mm) – Copyright (c) MONAI Consortium, Apache License 2.0.\n"
    "Source: https://huggingface.co/MONAI/wholeBody_ct_segmentation\n"
    "Trained on the TotalSegmentator dataset (Wasserthal et al., Radiology: AI 2023; data CC BY 4.0).\n"
    "Converted to ONNX for Recon Studio (trilinear upsampling as explicit interpolation; top-3 output head).\n"
)
print("written", out, len(data) / 1e6, "MB")
