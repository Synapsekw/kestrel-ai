/** The read-only diagnostics hook (spec §8): the packaged check and the acceptance read it. */
export const DIAGNOSTICS_KEY = "kestrel.diagnostics";

export interface ViewerStats {
  numVisiblePoints: number;
  visibleNodes: number;
  nodesLoading: number;
  firstPointsMs: number | null;
  settledMs: number | null;
  errors: string[];
  contextLost: boolean;
  /** Metres from the camera to the orbit target (plan decision 7). */
  cameraDistance: number;
}

export interface ColourSample {
  total: number;
  background: number;
  red: number;
  green: number;
  white: number;
}

export interface CloudViewerDiagnostics {
  stats(): ViewerStats;
  sampleColours(): ColourSample;
  pickCenter(): { x: number; y: number; z: number; level: number; uncertainty_m: number } | null;
  /** The viewer's straight-down pick at (x, y) within `radius` m: the jump arrival's Z refine. */
  pickDown(
    x: number,
    y: number,
    radius: number,
  ): { x: number; y: number; z: number; level: number; uncertainty_m: number } | null;
  /** The keys of the overlays currently drawn ("measure", "pin", "footprint"), for the e2e tests. */
  overlays(): string[];
}

declare global {
  interface Window {
    __kestrelCloudViewer?: CloudViewerDiagnostics;
  }
}

export function diagnosticsEnabled(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(DIAGNOSTICS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Installs `hook` (frozen: the page may read it, not change it) and returns the release for this
 * viewer's cleanup, which removes the hook only while it is still this viewer's own. */
export function installHook(hook: CloudViewerDiagnostics): () => void {
  const frozen = Object.freeze({ ...hook });
  window.__kestrelCloudViewer = frozen;
  return () => {
    if (window.__kestrelCloudViewer === frozen) delete window.__kestrelCloudViewer;
  };
}

export const MAX_ERRORS = 20;

/** The render loop reports a failed node on every frame it stays in view: keep each message once,
 * and the list bounded. */
export function pushErrorOnce(errors: string[], message: string): void {
  if (errors.length < MAX_ERRORS && !errors.includes(message)) errors.push(message);
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const DOMINANT = 40;

export function classifyPixels(
  rgba: Uint8Array,
  background: [number, number, number],
  tolerance = 6,
): ColourSample {
  const out: ColourSample = { total: 0, background: 0, red: 0, green: 0, white: 0 };
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    out.total += 1;
    if (
      Math.abs(r - background[0]) <= tolerance &&
      Math.abs(g - background[1]) <= tolerance &&
      Math.abs(b - background[2]) <= tolerance
    )
      out.background += 1;
    else if (r >= 250 && g >= 250 && b >= 250) out.white += 1;
    else if (r > g + DOMINANT && r > b + DOMINANT) out.red += 1;
    else if (g > r + DOMINANT && g > b + DOMINANT) out.green += 1;
  }
  return out;
}
