import sys, laspy, numpy as np
src, x, y, z = sys.argv[1], *map(float, sys.argv[2:5])
pts = []
with laspy.open(src) as r:
    for c in r.chunk_iterator(2_000_000):
        m = (np.abs(c.x - x) < 1.0) & (np.abs(c.y - y) < 1.0) & (np.abs(c.z - z) < 1.0)
        if m.any(): pts.append(np.column_stack([np.asarray(c.x)[m], np.asarray(c.y)[m], np.asarray(c.z)[m]]))
p = np.vstack(pts)
d = np.sqrt(((p[:, None, :] - p[None, :, :]) ** 2).sum(-1)); np.fill_diagonal(d, np.inf)
nn = d.min(1)
print(f"source points within a 2 m cube around ({x}, {y}, {z}): {len(p)}; nearest-neighbour spacing p50 {np.median(nn):.3f} m, p90 {np.percentile(nn, 90):.3f} m, mean {nn.mean():.3f} m")
