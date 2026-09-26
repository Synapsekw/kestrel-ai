import sys, laspy, numpy as np
src, x, y, rad = sys.argv[1], *map(float, sys.argv[2:5])
zs = []
with laspy.open(src) as r:
    for c in r.chunk_iterator(2_000_000):
        m = np.hypot(np.asarray(c.x) - x, np.asarray(c.y) - y) <= rad
        if m.any(): zs.append(np.asarray(c.z)[m])
z = np.sort(np.concatenate(zs))
print(f"column r<={rad} m at ({x}, {y}): {len(z)} points")
h, e = np.histogram(z, bins=np.arange(np.floor(z.min() / 10) * 10, z.max() + 10, 10))
for n, lo in zip(h, e):
    if n: print(f"  z {lo:7.1f}..{lo+10:7.1f}: {n}")
