import { toast } from "@/ui/toastStore";

export type Effects = "full" | "reduced";
export type EffectsChoice = "auto" | Effects;

const CHOICE_KEY = "kestrel.effects";
const AUTO_KEY = "kestrel.effects.auto";

/** Auto switches to reduced when the p95 frame time exceeds this (spec §4.3). */
export const FRAME_BUDGET_MS = 24;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts this session.
  }
}

/** Settings → Appearance → Visual effects: Auto (the default), Full or Reduced. */
export function readEffectsChoice(): EffectsChoice {
  const value = read(CHOICE_KEY);
  return value === "full" || value === "reduced" ? value : "auto";
}

function readAutoOutcome(): Effects | null {
  return read(AUTO_KEY) === "reduced" ? "reduced" : null;
}

/** The WebGL renderer string, or null when WebGL is unavailable. */
export function rendererName(): string | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return null;
  }
}

export function isSoftwareRenderer(name: string | null): boolean {
  return name !== null && /swiftshader|basic render/i.test(name);
}

export function resolveEffects(
  choice: EffectsChoice,
  autoOutcome: Effects | null,
  renderer: string | null,
): Effects {
  if (choice !== "auto") return choice;
  if (autoOutcome) return autoOutcome;
  return isSoftwareRenderer(renderer) ? "reduced" : "full";
}

/** Sets `<html data-effects>` from the saved choice. main.tsx calls it once, before the first paint. */
export function applyEffects(): Effects {
  const choice = readEffectsChoice();
  const outcome = readAutoOutcome();
  const renderer = choice === "auto" && outcome === null ? rendererName() : null;
  const effects = resolveEffects(choice, outcome, renderer);
  document.documentElement.dataset.effects = effects;
  return effects;
}

/** Settings (S2) and the palette's toggle (SH). Choosing Auto forgets the probe's outcome. */
export function setEffectsChoice(choice: EffectsChoice): Effects {
  write(CHOICE_KEY, choice === "auto" ? null : choice);
  if (choice === "auto") write(AUTO_KEY, null);
  return applyEffects();
}

export function p95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

type Raf = (callback: (time: number) => void) => void;

const browserRaf: Raf = (callback) => {
  requestAnimationFrame(callback);
};

/** A frame gap this long is a paused window (minimised, covered), not a slow frame. */
export const MAX_FRAME_GAP_MS = 500;

/**
 * Frame-to-frame times over `durationMs`, after `warmupMs` whose frames are not counted. Gaps above
 * MAX_FRAME_GAP_MS are dropped. Resolves `null` (no evidence, no decision) if the window is hidden
 * while measuring, or if no frame gap was usable.
 */
export function measureFrames(
  durationMs = 2000,
  raf: Raf = browserRaf,
  warmupMs = 300,
): Promise<number[] | null> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let first: number | null = null;
    let last = 0;
    let done = false;
    const finish = (result: number[] | null) => {
      done = true;
      document.removeEventListener("visibilitychange", onVisibility);
      resolve(result);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") finish(null);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const tick = (time: number) => {
      if (done) return;
      if (first === null) first = time;
      else if (time - first > warmupMs && time - last <= MAX_FRAME_GAP_MS) deltas.push(time - last);
      last = time;
      if (time - first >= warmupMs + durationMs) finish(deltas.length > 0 ? deltas : null);
      else raf(tick);
    };
    raf(tick);
  });
}

let probed = false;

/**
 * Auto's frame-time probe. The Overview calls it on its first render (S1). It runs at most once per
 * session, only in Auto, only when Auto has not decided before, and only while the window is visible.
 * When p95 exceeds the budget it switches to reduced, remembers that, and offers Undo, which chooses
 * Full for good (spec §15: the Settings override is final).
 */
export async function runAutoProbe(
  measure: () => Promise<number[] | null> = () => measureFrames(),
): Promise<Effects | null> {
  if (probed || readEffectsChoice() !== "auto" || readAutoOutcome() !== null) return null;
  if (document.documentElement.dataset.effects === "reduced") return null;
  if (document.visibilityState !== "visible") return null;
  probed = true;
  const samples = await measure();
  if (samples === null || document.visibilityState !== "visible") {
    // Hidden mid-probe (or nothing usable measured): no decision, and a later call may probe again.
    probed = false;
    return null;
  }
  if (p95(samples) <= FRAME_BUDGET_MS) return "full";
  write(AUTO_KEY, "reduced");
  document.documentElement.dataset.effects = "reduced";
  toast("info", "Visual effects reduced for smoother performance", {
    label: "Undo",
    onClick: () => {
      setEffectsChoice("full");
    },
  });
  return "reduced";
}

/** Tests only: forget that this session already probed. */
export function resetAutoProbe(): void {
  probed = false;
}
