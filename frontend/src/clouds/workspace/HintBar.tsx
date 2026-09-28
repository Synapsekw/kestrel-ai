import { useEffect, useState, type ReactNode } from "react";
import { cloudShortcut } from "@/clouds/keys";
import { Button, GlassPanel, KeyChord, cx } from "@/ui";
import { HINT_FADE_MS, NAV_TOOLS, type PaletteEntry } from "./tools";
import type { WorkspaceTool } from "./types";

/**
 * The hint bar (spec §6: top 14, centred pill, z 20): the tool's name, hint and key, its options and
 * live result, Save (Enter) / Cancel (Esc), and a feature's progress (R1's "Saving views n / N").
 * For Orbit, Pan and Fly it fades after 2.4 s.
 */
export function HintBar({
  entry,
  tool,
  progress,
  onCancel,
}: {
  entry: PaletteEntry;
  tool: WorkspaceTool | null;
  progress: ReactNode;
  onCancel(): void;
}) {
  const nav = NAV_TOOLS.includes(entry.id);
  const [fadedFor, setFadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!nav) return;
    const t = window.setTimeout(() => setFadedFor(entry.id), HINT_FADE_MS);
    return () => {
      window.clearTimeout(t);
      // Each arm shows the hint again for HINT_FADE_MS (Orbit → Distance → Orbit is not pre-faded).
      setFadedFor(null);
    };
  }, [nav, entry.id]);
  const faded = nav && fadedFor === entry.id && !progress;
  return (
    <GlassPanel
      variant="float"
      role="status"
      aria-live="polite"
      data-testid="cloud-hintbar"
      className={cx(
        "absolute left-1/2 top-3.5 z-20 flex max-w-[min(760px,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm transition-opacity duration-base ease-out reduce-motion:transition-none",
        faded ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <span className="font-semibold text-ink">{entry.label}</span>
      <span className="min-w-0 truncate text-muted">{entry.hint}</span>
      <KeyChord chord={entry.shortcut} />
      {tool?.hint && <span className="flex items-center gap-2 border-l border-line pl-2">{tool.hint}</span>}
      {tool?.onCommit && tool.hintActions !== false && (
        <span className="flex items-center gap-1.5 border-l border-line pl-2">
          <Button size="sm" variant="primary" disabled={tool.canCommit === false} onClick={tool.onCommit}>
            {tool.commitLabel ?? "Save"} <KeyChord chord={cloudShortcut("commit")} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel <KeyChord chord={cloudShortcut("cancel")} />
          </Button>
        </span>
      )}
      {progress && <span className="flex items-center gap-2 border-l border-line pl-2">{progress}</span>}
    </GlassPanel>
  );
}
