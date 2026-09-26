import json, struct, sys
from pathlib import Path
oct = Path(sys.argv[1]); pt = [float(v) for v in sys.argv[2].split(",")]
meta = json.loads((oct / "metadata.json").read_text("utf-8-sig"))
H = (oct / "hierarchy.bin").read_bytes()
bmin = meta["boundingBox"]["min"]; bmax = meta["boundingBox"]["max"]
def child_box(lo, hi, i):
    mid = [(a + b) / 2 for a, b in zip(lo, hi)]
    nlo, nhi = list(lo), list(hi)
    for ax, bit in ((0, 4), (1, 2), (2, 1)):
        if i & bit: nlo[ax] = mid[ax]
        else: nhi[ax] = mid[ax]
    return nlo, nhi
def load_chunk(off, size, root):
    # nodes in this chunk, breadth first; root = (name, lo, hi)
    nodes = [root]; out = {}
    for k in range(size // 22):
        t, mask, n, bo, bs = struct.unpack_from("<BBIqq", H, off + k * 22)
        name, lo, hi = nodes[k]
        out[name] = (t, mask, n, bo, bs, lo, hi)
        if t != 2:
            for i in range(8):
                if mask & (1 << i):
                    nodes.append((name + str(i), *child_box(lo, hi, i)))
    return out
allnodes = {}
pending = [(0, meta["hierarchy"]["firstChunkSize"], ("r", bmin, bmax))]
# walk only along the path to pt to bound work
name = "r"
chunk = load_chunk(0, meta["hierarchy"]["firstChunkSize"], ("r", bmin, bmax))
while True:
    t, mask, n, bo, bs, lo, hi = chunk[name]
    if t == 2:
        chunk = load_chunk(bo, bs, (name, lo, hi)); t, mask, n, bo, bs, lo, hi = chunk[name]
    print(f"level {len(name)-1} {name} type {t} points {n} size {hi[0]-lo[0]:.2f} m")
    nxt = None
    for i in range(8):
        if mask & (1 << i):
            clo, chi = child_box(lo, hi, i)
            if all(clo[a] <= pt[a] <= chi[a] for a in range(3)): nxt = name + str(i)
    if not nxt: break
    name = nxt
print("spacing", meta["spacing"])
