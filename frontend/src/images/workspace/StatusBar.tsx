import { Button, Kbd, Progress, cx } from "@/ui";
import type { Hint } from "./statusHints";

type Save = "saved" | "saving" | "failed";
export interface StatusBarProps {
  hints: Hint[];
  position: number | null;
  total: number;
  reviewed: number;
  save: Save;
  onRetry: () => void;
  className?: string;
}

const SAVE: Record<Save, { text: string; dot: string; tone: string }> = {
  saved: { text: "Saved", dot: "bg-ok", tone: "text-ok" },
  saving: { text: "Saving…", dot: "bg-line-strong", tone: "text-muted" },
  failed: { text: "Save failed", dot: "bg-danger", tone: "text-danger" },
};

/** §6.4: the active tool's keys on the left; position, reviewed and the save state on the right. */
export function StatusBar({ hints, position, total, reviewed, save, onRetry, className }: StatusBarProps) {
  const s = SAVE[save];
  return (
    <footer
      role="region"
      aria-label="Status bar"
      data-testid="images-status-bar"
      className={cx(
        "flex h-[30px] items-center gap-4 border-t border-line px-5 text-xs text-muted",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        {hints.map((h) => (
          <span key={h.help} className="inline-flex shrink-0 items-center gap-1 truncate">
            {h.keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
            {h.help}
          </span>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-4">
        <span>
          Image <b className="font-mono text-ink">{position ?? "—"}</b> /{" "}
          <span className="font-mono">{total}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          Reviewed <span className="font-mono text-ink">{reviewed}</span>
          <Progress value={total ? reviewed / total : 0} label="Reviewed" thin className="w-36" />
        </span>
        <span data-testid="save-state" className={cx("inline-flex items-center gap-1.5", s.tone)}>
          <i
            aria-hidden="true"
            className={cx("h-1.5 w-1.5 rounded-chip transition-colors duration-fast", s.dot)}
          />
          {s.text}
          {save === "failed" && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          )}
        </span>
      </div>
    </footer>
  );
}
