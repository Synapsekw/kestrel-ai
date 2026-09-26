"""Second rim derivation: the first (median XY of the top 0.3 m) lies over the hollow flue, so the
viewer's centre pick went down the throat to z = -41. Here: points with z within 3 m of the max,
their ring centre, and the densest rim point at the ring (chunked read)."""
import sys, laspy, numpy as np
src = sys.argv[1]; zmax = 189.554
pts = []
with laspy.open(src) as r:
    for p in r.chunk_iterator(2_000_000):
        z = np.asarray(p.z); m = z > zmax - 3.0
        if m.any(): pts.append(np.column_stack([np.asarray(p.x)[m], np.asarray(p.y)[m], z[m]]))
t = np.concatenate(pts)
c = np.median(t[:, :2], axis=0); d = np.hypot(t[:, 0] - c[0], t[:, 1] - c[1])
print("top3m_points", len(t), "centre", c.round(3).tolist(), "radius p10/p50/p90", np.percentile(d, [10, 50, 90]).round(2).tolist())
# densest point: most neighbours within 0.5 m
nb = np.array([(np.hypot(t[:, 0] - x, t[:, 1] - y) < 0.5).sum() for x, y in t[:, :2]])
i = int(nb.argmax())
print("rim point", t[i].round(3).tolist(), "neighbours<0.5m", int(nb[i]), "dist_from_centre", round(float(d[i]), 2))
print(f"KESTREL_RIM={t[i,0]:.3f},{t[i,1]:.3f}")
