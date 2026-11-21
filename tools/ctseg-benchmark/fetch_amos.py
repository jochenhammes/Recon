import re, sys, os
from remotezip import RemoteZip
out = sys.argv[1]; n = int(sys.argv[2])
z = RemoteZip('https://zenodo.org/api/records/7262581/files/amos22.zip/content')
names = z.namelist()
z.extract('amos22/dataset.json', out)
va = sorted(x for x in names if re.search(r'labelsVa/amos_0\d+\.nii', x) and int(re.search(r'amos_(\d+)', x).group(1)) < 500)
for lab in va[:n]:
    img = lab.replace('labelsVa', 'imagesVa')
    for m in (img, lab):
        if not os.path.exists(os.path.join(out, m)):
            z.extract(m, out); print('got', m, flush=True)
