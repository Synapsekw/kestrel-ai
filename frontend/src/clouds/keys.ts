import {
  GLOBAL_KEYS,
  REVIEW_KEYS,
  WORKSPACE_KEYS,
  chordOf,
  type KeyEntry,
  type KeyLike,
  type KeyScope,
} from "@/ui/keymap";

/**
 * The point cloud keys, resolved against F's one keymap (spec §6; plan x1 Ruling 9). Fly mode is F
 * §5.6's one exception: while it holds pointer lock only the fly keys (Shift = fast) and the global
 * keys resolve, so the review keys (A, X, 1–9, T) and the tool keys are suspended. Fly keys must not
 * go through `useToolShortcuts`, which refuses review keys such as A.
 */
export type CloudNav = "orbit" | "pan" | "fly";

export interface ResolvedKey {
  scope: KeyScope;
  action: string;
  /** Fly mode only: Shift was held. */
  fast?: boolean;
}

function index(entries: readonly KeyEntry[]): Map<string, KeyEntry> {
  const m = new Map<string, KeyEntry>();
  for (const e of entries) for (const k of e.keys) m.set(k, e);
  return m;
}

const GLOBAL = index(GLOBAL_KEYS);
const REVIEW = index(REVIEW_KEYS);
const TOOLS = index(WORKSPACE_KEYS.clouds);
const FLY = index(WORKSPACE_KEYS["clouds.fly"]);

export function reviewKeysLive(nav: CloudNav): boolean {
  return nav !== "fly";
}

export function resolveCloudKey(e: KeyLike, nav: CloudNav): ResolvedKey | null {
  const chord = chordOf(e);
  if (nav === "fly") {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const fly = FLY.get(e.shiftKey ? chordOf({ ...e, shiftKey: false }) : chord);
      if (fly) return { scope: fly.scope, action: fly.action, fast: e.shiftKey };
    }
    const g = GLOBAL.get(chord);
    return g ? { scope: g.scope, action: g.action } : null;
  }
  const hit = GLOBAL.get(chord) ?? REVIEW.get(chord) ?? TOOLS.get(chord);
  return hit ? { scope: hit.scope, action: hit.action } : null;
}

/**
 * The chord of a clouds action (then of a global one, e.g. "commit" / "cancel"), for `ToolButton
 * shortcut` and key caps; throws on an action the keymap lacks.
 */
export function cloudShortcut(action: string): string {
  const e =
    WORKSPACE_KEYS.clouds.find((k) => k.action === action) ?? GLOBAL_KEYS.find((k) => k.action === action);
  if (!e) throw new Error(`no clouds key for "${action}"`);
  return e.keys[0];
}
