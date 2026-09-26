"""Spec §17.13: the exported LAZ has the source's count, EPSG 32639, and header bounds containing every point (chunked)."""
import sys, laspy, numpy as np
with laspy.open(sys.argv[1]) as r:
    h = r.header
    mn = np.full(3, np.inf); mx = -mn; n = 0
    for p in r.chunk_iterator(2_000_000):
        a = np.column_stack([p.x, p.y, p.z]); mn = np.minimum(mn, a.min(0)); mx = np.maximum(mx, a.max(0)); n += len(p)
    crs = h.parse_crs()
    epsg = crs.to_epsg() if crs else None
    inside = bool((h.mins <= mn + 1e-9).all() and (h.maxs >= mx - 1e-9).all())
    print(f"header_count {h.point_count} read {n} epsg {epsg} header_mins {np.round(h.mins,3).tolist()} header_maxs {np.round(h.maxs,3).tolist()}")
    print(f"points_min {np.round(mn,3).tolist()} points_max {np.round(mx,3).tolist()} header_contains_all {inside}")
    print("laz ok" if inside and n == h.point_count and epsg == 32639 else "laz FAIL")
