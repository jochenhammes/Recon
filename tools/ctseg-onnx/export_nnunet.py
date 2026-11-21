"""
Exports an nnU-Net v2 3d_fullres model (fold 0) to ONNX for Recon Studio – generalized from
tools/totalseg-onnx/export.py (TotalSegmentator 3 mm), e.g. the TotalSegmentator 1.5 mm organ model.

Usage:
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install nnunetv2 onnx onnxruntime numpy
  # weights: https://github.com/wasserth/TotalSegmentator/releases/download/v2.0.0-weights/Dataset297_TotalSegmentator_total_3mm_1559subj.zip
  python export_nnunet.py <unzipped Dataset… folder> <output dir> --name="…" --source="…" [--license=Apache-2.0] [--fold=fold_0] [--block=10]
  # e.g. TotalSegmentator organs 1.5 mm:
  #   …/v2.0.0-weights/Dataset291_TotalSegmentator_part1_organs_1559subj.zip
  # MOOSE 3 clin_ct_organs (CC BY 4.0, --fold=fold_all):
  #   https://github.com/ENHANCE-PET/MOOSE/releases/download/moosez-v.3.1.3/clin_ct_organs_ras_07052025.zip

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

def opt(key, default):
    return next((a.split("=", 1)[1] for a in sys.argv if a.startswith(f"--{key}=")), default)


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
ckpt = torch.load(folder / opt("fold", "fold_0") / "checkpoint_final.pth", map_location="cpu", weights_only=False)
net.load_state_dict(ckpt["network_weights"])
net.eval()
reference_net = __import__("copy").deepcopy(net)


class ShuffleUp3d(torch.nn.Module):
    """ConvTranspose3d with kernel = stride (e.g. 2×2×2 or anisotropic 1×2×2) as 1×1×1 Conv to a·b·c·C_out
    channels plus a 3D pixel shuffle.

    ONNX Runtime's WebGPU backend only implements 2-D ConvTranspose; Conv (3-D), Reshape and Transpose
    (rank ≤ 6) are supported, so this form runs on the GPU. Mathematically identical (non-overlapping blocks).
    """

    def __init__(self, ct: torch.nn.ConvTranspose3d):
        super().__init__()
        k = tuple(ct.kernel_size)
        assert k == tuple(ct.stride) and ct.groups == 1 and tuple(ct.padding) == (0, 0, 0)
        self.k = k
        cin, cout = ct.in_channels, ct.out_channels
        self.cout = cout
        m = k[0] * k[1] * k[2]
        self.conv = torch.nn.Conv3d(cin, cout * m, 1, bias=ct.bias is not None)
        w = ct.weight.data  # (cin, cout, a, b, c)
        self.conv.weight.data = w.permute(1, 2, 3, 4, 0).reshape(cout * m, cin, 1, 1, 1).clone()
        if ct.bias is not None:
            self.conv.bias.data = ct.bias.data.repeat_interleave(m).clone()

    def forward(self, x):
        a, b, c = self.k
        y = self.conv(x)  # (n, cout·(a,b,c), d, h, w)
        n, _, d, h, w = y.shape
        o = self.cout
        # Unfold one axis at a time so that no tensor exceeds rank 6.
        if c > 1:
            y = y.reshape(n, o * a * b, c, d, h, w).permute(0, 1, 3, 4, 5, 2).reshape(n, o * a * b, d, h, w * c)  # c → w
        if b > 1:
            y = y.reshape(n, o * a, b, d, h, w * c).permute(0, 1, 3, 4, 2, 5).reshape(n, o * a, d, h * b, w * c)  # b → h
        if a > 1:
            y = y.reshape(n, o, a, d, h * b, w * c).permute(0, 1, 3, 2, 4, 5).reshape(n, o, d * a, h * b, w * c)  # a → d
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


class Conv3dAs2d(torch.nn.Module):
    """Conv3d (k×k×k) as k 2-D convolutions over (H, W) with the depth folded into the batch, summed over the
    depth offsets. ONNX Runtime's WebGPU backend has optimized 2-D convolutions but only a naive 3-D kernel."""

    def __init__(self, c: torch.nn.Conv3d):
        super().__init__()
        assert c.groups == 1 and tuple(c.dilation) == (1, 1, 1)
        self.kd, self.sd, self.pd = c.kernel_size[0], c.stride[0], c.padding[0]
        self.cout = c.out_channels
        self.convs = torch.nn.ModuleList()
        for k in range(self.kd):
            c2 = torch.nn.Conv2d(c.in_channels, c.out_channels, c.kernel_size[1:], stride=c.stride[1:], padding=c.padding[1:], bias=(k == 0 and c.bias is not None))
            c2.weight.data = c.weight.data[:, :, k].clone()
            if k == 0 and c.bias is not None:
                c2.bias.data = c.bias.data.clone()
            self.convs.append(c2)

    def forward(self, x):
        n, ci, d, h, w = x.shape
        if self.pd:
            x = torch.nn.functional.pad(x, (0, 0, 0, 0, self.pd, self.pd))
        do = (d + 2 * self.pd - self.kd) // self.sd + 1
        # One transpose to (n, depth, c, h, w); the depth slices are then contiguous (no copy per offset).
        xt = x.transpose(1, 2)
        out = None
        for k, conv in enumerate(self.convs):
            xs = xt[:, k : k + self.sd * (do - 1) + 1 : self.sd].reshape(n * do, ci, h, w)
            y = conv(xs)
            out = y if out is None else out + y
        ho, wo = out.shape[-2:]
        return out.reshape(n, do, self.cout, ho, wo).transpose(1, 2)


def replace_conv3d(module: torch.nn.Module) -> int:
    count = 0
    for name, child in module.named_children():
        if isinstance(child, torch.nn.Conv3d) and child.kernel_size[0] > 1:
            setattr(module, name, Conv3dAs2d(child))
            count += 1
        else:
            count += replace_conv3d(child)
    return count


# Opt-in: faster 2-D kernels on WebGPU, but ~3x the peak memory (tabs were killed in Safari) – off by default.
AS_2D = "--2d" in sys.argv
if AS_2D:
    print("replaced Conv3d by 2-D convolutions:", replace_conv3d(net))

TOPK = 3


class TopKHead(torch.nn.Module):
    """Network + the TOPK most probable classes per voxel as [class₁, p₁, class₂, p₂, …] (float), output
    (1, 2·TOPK, D, H, W) instead of (1, C, D, H, W) logits – far less data to copy back.

    Memory-light: the final 1×1×1 classification conv is evaluated in blocks of BLOCK classes; per block the
    block's top-k and log-sum-exp are merged into running results, so no tensor of all C logits exists.
    Only ReduceMax/Equal/Where/Exp/Log/ReduceSum/Concat are used (WebGPU has no TopK)."""

    BLOCK = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--block=")), 10))

    def __init__(self, net, classes):
        super().__init__()
        seg = net.decoder.seg_layers[-1]
        net.decoder.seg_layers[-1] = torch.nn.Identity()  # network now returns the final feature maps
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
        """TOPK largest of `values` (channel axis) with their labels, via repeated max + masking."""
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
            # Data dependency on the previous block forces sequential execution: otherwise the runtime may run all
            # block convolutions first and hold every logits block at once (peak memory as with full logits).
            src = feat if run_v is None else feat + 0.0 * (run_v[-1] + run_i[-1] + lse)[:, :, :1, :1, :1]
            logits = conv(src)
            m = logits.amax(1, keepdim=True)
            block_lse = m + torch.log(torch.exp(logits - m).sum(1, keepdim=True))
            v, i = self._topk(logits, getattr(self, f"cls{a}"))
            if run_v is None:
                run_v, run_i, lse = v, i, block_lse
            else:
                mx = torch.where(lse > block_lse, lse, block_lse)  # no Max op on WebGPU
                lse = mx + torch.log(torch.exp(lse - mx) + torch.exp(block_lse - mx))
                vv, ii = self._topk(torch.cat(run_v + v, 1), torch.cat(run_i + i, 1))
                run_v, run_i = vv, ii
        outs = []
        for v, i in zip(run_v, run_i):
            outs += [i, torch.exp(v - lse)]
        return torch.cat(outs, 1)


head = TopKHead(net, n_classes).eval()

patch = list(cm.patch_size)
dummy = torch.randn(1, 1, *patch)
onnx_path = out / "model.onnx"
torch.onnx.export(
    head, dummy, onnx_path, input_names=["input"], output_names=["logits"], opset_version=17,
    dynamic_axes=None, do_constant_folding=True, dynamo=False,
)

# Check against PyTorch.
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

intensity = plans["foreground_intensity_properties_per_channel"]["0"]
meta = {
    "name": opt("name", src.name),
    "source": opt("source", src.name),
    "license": opt("license", "Apache-2.0"),
    "parts": parts,
    "bytes": len(data),
    "sha256": hashlib.sha256(data).hexdigest(),
    "patchSize": patch,  # axis order of the array: (S, A, R) = (z, y, x) of a RAS-aligned grid
    "spacing": cm.spacing,
    "axes": "RAS (array z = superior, y = anterior, x = right)",
    "normalization": {"clip": [intensity["percentile_00_5"], intensity["percentile_99_5"]], "mean": intensity["mean"], "std": intensity["std"]},
    "labels": {str(v): k for k, v in labels.items()},
    # Output: (1, 2·k, D, H, W) = [class₁, p₁, class₂, p₂, …] per voxel.
    "output": {"kind": "topk", "k": TOPK},
}
(out / "model.json").write_text(json.dumps(meta, indent=1))
print("written", parts, len(data) / 1e6, "MB")
