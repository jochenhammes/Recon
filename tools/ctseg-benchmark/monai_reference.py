import json, sys, numpy as np, torch
from monai.networks.nets import SegResNet
from monai.transforms import Compose, LoadImaged, EnsureChannelFirstd, Orientationd, Spacingd, NormalizeIntensityd, ScaleIntensityd, Invertd, AsDiscreted
from monai.inferers import SlidingWindowInferer
bundle, img, lab = sys.argv[1:4]
cfg = json.load(open(bundle + "/configs/inference.json")); nd = cfg["network_def"]
meta = json.load(open(bundle + "/configs/metadata.json"))
names = meta["network_data_format"]["outputs"]["pred"]["channel_def"]
net = SegResNet(spatial_dims=3, in_channels=1, out_channels=nd["out_channels"], init_filters=nd["init_filters"], blocks_down=nd["blocks_down"], blocks_up=nd["blocks_up"])
sd = torch.load(bundle + "/models/model_lowres.pt", map_location="cpu", weights_only=False); net.load_state_dict(sd.get("state_dict", sd)); net.eval()
pre = Compose([LoadImaged(keys=["image"]), EnsureChannelFirstd(keys=["image"]), Orientationd(keys=["image"], axcodes="RAS"),
               Spacingd(keys=["image"], pixdim=[3.0, 3.0, 3.0], mode="bilinear"), NormalizeIntensityd(keys="image", nonzero=True), ScaleIntensityd(keys="image", minv=-1.0, maxv=1.0)])
d = pre({"image": img})
from monai.transforms import LoadImage
label = LoadImage(image_only=True)(lab)
print("image shape", d["image"].shape)
with torch.no_grad():
    p = SlidingWindowInferer(roi_size=[96, 96, 96], sw_batch_size=1, overlap=0.25, padding_mode="replicate", mode="gaussian")(d["image"][None], net)
pred = p[0].argmax(0).numpy()
lt = Compose([LoadImaged(keys=["label"]), EnsureChannelFirstd(keys=["label"]), Orientationd(keys=["label"], axcodes="RAS"), Spacingd(keys=["label"], pixdim=[3.0, 3.0, 3.0], mode="nearest")])
ref = lt({"label": lab})["label"][0].numpy().round().astype(int)
print("pred", pred.shape, "ref", ref.shape, "pred labels", np.unique(pred)[:20])
inv_names = {v: int(k) for k, v in names.items()}
amos = {1: "spleen", 2: "kidney_right", 3: "kidney_left", 6: "liver", 7: "stomach", 8: "aorta", 10: "pancreas"}
for a, n in amos.items():
    x = pred == inv_names[n]; y = ref == a
    print(n, round(2 * (x & y).sum() / max(1, x.sum() + y.sum()), 3))
for a in (1, 3):
    vals, cnt = np.unique(pred[ref == a], return_counts=True)
    print("AMOS", a, [(names[str(v)] if str(v) in names else v, c) for v, c in sorted(zip(vals, cnt), key=lambda t: -t[1])[:4]])
np.savez_compressed(sys.argv[4], img=d["image"][0].numpy(), pred=pred, ref=ref)
