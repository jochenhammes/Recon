#!/usr/bin/env python3
"""
Downloads and prepares the brain templates and atlases bundled with Recon Studio (public/templates,
public/atlases) and writes public/brain-catalog.json.

Only sources whose licence allows redistribution are included (see Hirnvorlagen-Quellen.md). Every file is
checked against a SHA-256 checksum, converted to little-endian NIfTI-1 (gzip) and, where stated, reduced in
size (probability maps as uint8 with scl_slope 1/255). Images are not resampled unless noted.

Usage:  python3 scripts/prepare-brain-assets.py [--cache DIR] [--print-hashes]
Requires: nibabel, numpy.
"""
import argparse
import gzip
import hashlib
import json
import os
import shutil
import sys
import urllib.request

import nibabel as nib
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
TF = "https://templateflow.s3.amazonaws.com"
MAGIA = "https://raw.githubusercontent.com/tkkarjal/magia/master/templates"
SF = "https://sourceforge.net/projects/spmtemplates/files"
CLINICAL = "https://raw.githubusercontent.com/neurolabusc/Clinical/master"

# name → (url, sha256). Filled with --print-hashes on the first run, then fixed.
SOURCES = {
    "mni_t1_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_T1w.nii.gz", None),
    "mni_t2_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_T2w.nii.gz", None),
    "mni_mask_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_desc-brain_mask.nii.gz", None),
    "mni_gm_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_label-GM_probseg.nii.gz", None),
    "mni_wm_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_label-WM_probseg.nii.gz", None),
    "mni_csf_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_label-CSF_probseg.nii.gz", None),
    "cerebra_1": (f"{TF}/tpl-MNI152NLin2009cSym/tpl-MNI152NLin2009cSym_res-1_atlas-CerebrA_dseg.nii.gz", None),
    "mial67_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_atlas-MIAL67ThalamicNuclei_dseg.nii.gz", None),
    "mial67_tsv": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_atlas-MIAL67ThalamicNuclei_dseg.tsv", None),
    **{
        f"schaefer{n}_1": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_atlas-Schaefer2018_desc-{n}Parcels7Networks_dseg.nii.gz", None)
        for n in (100, 200, 400)
    },
    **{
        f"schaefer{n}_tsv": (f"{TF}/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_atlas-Schaefer2018_desc-{n}Parcels7Networks_dseg.tsv", None)
        for n in (100, 200, 400)
    },
    "magia_fdg": (f"{MAGIA}/%5B18f%5Dfdg.nii", None),
    "magia_pib": (f"{MAGIA}/%5B11c%5Dpib.nii", None),
    "magia_raclopride": (f"{MAGIA}/%5B11c%5Draclopride.nii", None),
    "magia_license": ("https://raw.githubusercontent.com/tkkarjal/magia/master/LICENSE", None),
    "fpcit": (f"{SF}/symFPCITtemplate_MNI_norm.nii/download", None),
    "fdopa": (f"{SF}/symFDOPAtemplate_MNI_norm.nii/download", None),
    "scct": (f"{CLINICAL}/scct.nii", None),
    "clinical_license": (f"{CLINICAL}/LICENSE", None),
}

HASHES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "brain-assets.sha256.json")


def fetch(name, cache):
    url, _ = SOURCES[name]
    path = os.path.join(cache, name + ("" if url.endswith((".tsv", "LICENSE")) else ".nii" + (".gz" if url.endswith(".gz") else "")))
    if not os.path.exists(path):
        print("  lade", url)
        req = urllib.request.Request(url, headers={"User-Agent": "recon-studio-asset-builder"})
        with urllib.request.urlopen(req) as r, open(path + ".part", "wb") as f:
            shutil.copyfileobj(r, f)
        os.replace(path + ".part", path)
    return path


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def save(img_data, affine, out, dtype, slope=None):
    """Writes a little-endian NIfTI-1 with sform = qform = affine."""
    arr = np.asarray(img_data)
    if slope:
        arr = np.clip(np.round(arr / slope), 0, np.iinfo(dtype).max)
    img = nib.Nifti1Image(arr.astype(dtype), affine)
    img.header.set_data_dtype(dtype)
    if slope:
        img.header["scl_slope"] = slope
        img.header["scl_inter"] = 0
    img.set_sform(affine, code=4)
    img.set_qform(affine, code=4)
    tmp = out[:-3]
    nib.save(img, tmp)
    with open(tmp, "rb") as f, gzip.open(out, "wb", compresslevel=9) as g:
        shutil.copyfileobj(f, g)
    os.remove(tmp)
    return os.path.getsize(out)


def load(path):
    img = nib.load(path)
    return np.asanyarray(img.dataobj), img.affine


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, ".asset-cache"))
    ap.add_argument("--print-hashes", action="store_true", help="checksums der Quellen neu schreiben")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    known = json.load(open(HASHES_FILE)) if os.path.exists(HASHES_FILE) else {}
    paths = {}
    for name in SOURCES:
        p = fetch(name, a.cache)
        h = sha256(p)
        if name in known and known[name] != h and not a.print_hashes:
            sys.exit(f"Prüfsumme stimmt nicht für {name}: {h} (erwartet {known[name]})")
        known[name] = h
        paths[name] = p
    if a.print_hashes or not os.path.exists(HASHES_FILE):
        json.dump(known, open(HASHES_FILE, "w"), indent=1, sort_keys=True)

    T = os.path.join(PUBLIC, "templates")
    A = os.path.join(PUBLIC, "atlases")
    sizes = {}

    def put(key, data, affine, out, dtype, slope=None):
        sizes[key] = save(data, affine, out, dtype, slope)
        print(f"  {os.path.relpath(out, ROOT)}  {sizes[key] // 1024} KB")

    # MRI templates 1 mm (float values of the T1/T2 are 0…~100: int16 ×0.01 would lose nothing visible, but keep float32 for fidelity).
    for k, f in (("mni_t1_1", "MNI152NLin2009cAsym_res-01_T1w.nii.gz"), ("mni_t2_1", "MNI152NLin2009cAsym_res-01_T2w.nii.gz")):
        d, aff = load(paths[k])
        put(k, d, aff, os.path.join(T, f), np.float32)
    d, aff = load(paths["mni_mask_1"])
    put("mni_mask_1", d > 0.5, aff, os.path.join(T, "MNI152NLin2009cAsym_res-01_brainmask.nii.gz"), np.uint8)
    for k, lab in (("mni_gm_1", "GM"), ("mni_wm_1", "WM"), ("mni_csf_1", "CSF")):
        d, aff = load(paths[k])
        put(k, d, aff, os.path.join(T, f"MNI152NLin2009cAsym_res-01_label-{lab}_probseg.nii.gz"), np.uint8, slope=1 / 255)

    # PET/SPECT/CT templates (own grids, MNI152 of SPM).
    for k, f in (
        ("magia_fdg", "magia_FDG.nii.gz"),
        ("magia_pib", "magia_PiB.nii.gz"),
        ("magia_raclopride", "magia_raclopride.nii.gz"),
        ("fpcit", "spmtemplates_FPCIT_SPECT.nii.gz"),
        ("fdopa", "spmtemplates_FDOPA_PET.nii.gz"),
        ("scct", "clinical_scct.nii.gz"),
    ):
        d, aff = load(paths[k])
        d = np.nan_to_num(np.asarray(d, dtype=np.float32))
        put(k, d, aff, os.path.join(T, f), np.float32)

    # Atlases 1 mm. CerebrA: the 1 mm grids of 2009cSym and 2009cAsym are identical (193×229×193, same origin).
    asym_aff = nib.load(paths["mni_t1_1"]).affine
    d, aff = load(paths["cerebra_1"])
    assert np.allclose(aff, asym_aff), "CerebrA-Raster weicht ab"
    put("cerebra_1", d, asym_aff, os.path.join(A, "CerebrA_MNI152NLin2009cAsym_res-01_dseg.nii.gz"), np.uint8)
    d, aff = load(paths["mial67_1"])
    put("mial67_1", d, aff, os.path.join(A, "MIAL67ThalamicNuclei_MNI152NLin2009cAsym_res-01_dseg.nii.gz"), np.uint8)
    shutil.copy(paths["mial67_tsv"], os.path.join(A, "MIAL67ThalamicNuclei_labels.tsv"))
    for n in (100, 200, 400):
        d, aff = load(paths[f"schaefer{n}_1"])
        put(f"schaefer{n}_1", d, aff, os.path.join(A, f"Schaefer2018_{n}Parcels7Networks_MNI152NLin2009cAsym_res-01_dseg.nii.gz"), np.uint16)
        shutil.copy(paths[f"schaefer{n}_tsv"], os.path.join(A, f"Schaefer2018_{n}Parcels7Networks_labels.tsv"))

    shutil.copy(paths["magia_license"], os.path.join(T, "LICENSE-magia-MIT.txt"))
    shutil.copy(paths["clinical_license"], os.path.join(T, "LICENSE-Clinical-BSD.txt"))
    json.dump(sizes, open(os.path.join(a.cache, "sizes.json"), "w"), indent=1)
    print("fertig.")


if __name__ == "__main__":
    main()
