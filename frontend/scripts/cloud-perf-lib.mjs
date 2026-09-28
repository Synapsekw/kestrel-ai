// Pure helpers for the point-cloud CDP drivers (C-G): check-packaged-webview.mjs and
// measure-cloud-workspace.mjs. Tested by src/clouds/cloudPerfLib.test.ts.

/** The sorted sample at min(n - 1, ceil(n * q) - 1): F's probe rule (src/app/effects.ts). */
export function percentileOf(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))];
}

const round2 = (n) => Math.round(n * 100) / 100;

export function frameStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: round2(percentileOf(sorted, 0.5)),
    p95: round2(percentileOf(sorted, 0.95)),
    max: round2(sorted.at(-1) ?? 0),
  };
}

/**
 * Total time (ms) spent in each named function over a CDP CPU profile, callees included. A node
 * under an ancestor of the same name is not counted again (recursion). Sample time is the profile's
 * mean interval.
 */
export function profileTotals(profile, names) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const interval = profile.samples.length
    ? (profile.endTime - profile.startTime) / profile.samples.length
    : 0;
  const totalHits = new Map();
  const hits = (node) => {
    if (totalHits.has(node.id)) return totalHits.get(node.id);
    let sum = node.hitCount ?? 0;
    for (const c of node.children ?? []) sum += hits(byId.get(c));
    totalHits.set(node.id, sum);
    return sum;
  };
  const out = Object.fromEntries(names.map((n) => [n, 0]));
  const walk = (node, open) => {
    const name = node.callFrame.functionName;
    const counts = names.includes(name) && !open.has(name);
    if (counts) out[name] += (hits(node) * interval) / 1000;
    const next = counts ? new Set([...open, name]) : open;
    for (const c of node.children ?? []) walk(byId.get(c), next);
  };
  const childIds = new Set(profile.nodes.flatMap((n) => n.children ?? []));
  for (const root of profile.nodes.filter((n) => !childIds.has(n.id))) walk(root, new Set());
  return out;
}

/** n distinct XY points on a grid over the inner 80 % of `bounds` = [minx, miny, minz, maxx, maxy, maxz]. */
export function pinGrid(bounds, n) {
  const [x0, y0, , x1, y1] = bounds;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const ix = (x1 - x0) * 0.8;
  const iy = (y1 - y0) * 0.8;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push([
      x0 + (x1 - x0) * 0.1 + (cols === 1 ? ix / 2 : (ix * c) / (cols - 1)),
      y0 + (y1 - y0) * 0.1 + (rows === 1 ? iy / 2 : (iy * r) / (rows - 1)),
    ]);
  }
  return out;
}

/** p inside a box of `size` centred on `centre`, rotated `yaw_deg` about Z (counter-clockwise). */
export function insideClipBox(p, box, tol = 1e-6) {
  const a = (-box.yaw_deg * Math.PI) / 180;
  const dx = p[0] - box.centre[0];
  const dy = p[1] - box.centre[1];
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const lz = p[2] - box.centre[2];
  return (
    Math.abs(lx) <= box.size[0] / 2 + tol &&
    Math.abs(ly) <= box.size[1] / 2 + tol &&
    Math.abs(lz) <= box.size[2] / 2 + tol
  );
}

export function pngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

export function colourSpread(samples) {
  const back = samples[0];
  return {
    distinct: new Set(samples).size,
    nonBackground: samples.length ? samples.filter((v) => v !== back).length / samples.length : 0,
  };
}

/** Calls per named function from CDP precise coverage (callCount): the first range is the function. */
export function coverageCounts(coverage, names) {
  const out = Object.fromEntries(names.map((n) => [n, 0]));
  for (const script of coverage.result)
    for (const fn of script.functions)
      if (names.includes(fn.functionName)) out[fn.functionName] += fn.ranges[0]?.count ?? 0;
  return out;
}
