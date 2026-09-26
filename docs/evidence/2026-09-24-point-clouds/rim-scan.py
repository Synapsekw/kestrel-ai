import sys, laspy, numpy as np
src = sys.argv[1]
mn = np.full(3, np.inf); mx = -mn
with laspy.open(src) as r:
    for p in r.chunk_iterator(2_000_000):
        a = np.column_stack([p.x, p.y, p.z]); mn = np.minimum(mn, a.min(0)); mx = np.maximum(mx, a.max(0))
print("bounds", [*mn.round(3), *mx.round(3)])
top = []
with laspy.open(src) as r:
    for p in r.chunk_iterator(2_000_000):
        z = np.asarray(p.z); m = z > mx[2] - 0.3
        if m.any(): top.append(np.column_stack([np.asarray(p.x)[m], np.asarray(p.y)[m], z[m]]))
t = np.concatenate(top)
print("top_points", len(t), "median_xy", np.median(t[:,0]).round(3), np.median(t[:,1]).round(3), "z", t[:,2].min().round(3), t[:,2].max().round(3))
print("xy_spread", (t[:,0].max()-t[:,0].min()).round(3), (t[:,1].max()-t[:,1].min()).round(3))
