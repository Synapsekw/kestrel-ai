import { useCallback, useState, type ReactNode } from "react";
import { Button, IconButton, Kbd, Pill } from "@/ui";
import { HOTKEY_HELP } from "./hotkeys";

export interface ToolbarProps {
  fileName: string;
  position: { index: number; count: number } | null;
  zoom: number;
  pending: number;
  canUndo: boolean;
  canRedo: boolean;
  onPrev: () => void;
  onNext: () => void;
  onFit: () => void;
  onOneToOne: () => void;
  onUndo: () => void;
  onRedo: () => void;
  extra?: ReactNode;
  /** Rendered before everything else: the way back to the list that opened the editor. */
  lead?: ReactNode;
}

/** A thin vertical rule between toolbar groups. */
export function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />;
}

export function EditorToolbar(p: ToolbarProps) {
  const saving = p.pending > 0;
  const [keysOpen, setKeysOpen] = useState(false);
  const focusHelp = useCallback((node: HTMLDivElement | null) => {
    node?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="flex shrink-0 flex-col border-b border-line bg-ground text-[13px] text-ink">
      <div className="flex min-h-14 items-center gap-1 border-b border-line px-3 py-2">
        {p.lead}
        <span className="min-w-0 flex-1 truncate px-2 font-mono text-xs text-ink" title={p.fileName}>
          {p.fileName}
        </span>
        <IconButton
          icon="arrow-left"
          label="Previous"
          title="Previous image (Ctrl+Left)"
          size="sm"
          onClick={p.onPrev}
          disabled={!p.position || p.position.index <= 0}
        />
        <IconButton
          icon="arrow-right"
          label="Next"
          title="Next image (Ctrl+Right)"
          size="sm"
          onClick={p.onNext}
          disabled={!p.position || p.position.index >= p.position.count - 1}
        />
        {p.position && p.position.index >= 0 && (
          <span className="px-1 tabular-nums text-muted" data-testid="position">
            {p.position.index + 1} / {p.position.count}
          </span>
        )}
      </div>
      <div className="relative flex min-h-11 flex-wrap items-center gap-1 px-3 py-1.5">
        <IconButton icon="fit" label="Fit" title="Fit (F)" size="sm" onClick={p.onFit} />
        <IconButton
          icon="one-to-one"
          label="1:1"
          title="1:1 (0 or Ctrl+1)"
          size="sm"
          onClick={p.onOneToOne}
        />
        <span className="w-11 text-right tabular-nums text-muted" data-testid="zoom">
          {Math.round(p.zoom * 100)}%
        </span>
        <ToolbarDivider />
        {/* Undo/redo wait for in-flight saves: a compensating call must target settled state. */}
        <IconButton
          icon="undo"
          label="Undo"
          title="Undo (Ctrl+Z)"
          size="sm"
          onClick={p.onUndo}
          disabled={!p.canUndo || saving}
        />
        <IconButton
          icon="redo"
          label="Redo"
          title="Redo (Ctrl+Y)"
          size="sm"
          onClick={p.onRedo}
          disabled={!p.canRedo || saving}
        />
        {p.extra}
        <div>
          <IconButton
            icon="keyboard"
            label="Keyboard shortcuts"
            size="sm"
            aria-expanded={keysOpen}
            onClick={() => setKeysOpen((v) => !v)}
          />
          {keysOpen && (
            <div
              role="dialog"
              tabIndex={-1}
              ref={focusHelp}
              aria-label="Keyboard shortcuts"
              onKeyDown={(e) => e.key === "Escape" && setKeysOpen(false)}
              className="absolute left-3 top-full z-20 mt-1.5 max-h-[calc(100vh-180px)] w-80 max-w-[calc(100%-24px)] overflow-y-auto rounded-lg border border-line bg-panel p-3 text-[13px] shadow-float"
            >
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
                {HOTKEY_HELP.map((h) => (
                  <div key={h.keys} className="contents">
                    <dt>
                      <Kbd>{h.keys}</Kbd>
                    </dt>
                    <dd className="text-muted">{h.does}</dd>
                  </div>
                ))}
              </dl>
              <Button size="sm" className="mt-3" onClick={() => setKeysOpen(false)}>
                Close
              </Button>
            </div>
          )}
        </div>
        <Pill role="status" tone={saving ? "warn" : "neutral"} dot={saving} className="ml-auto">
          {saving ? "Saving…" : "Saved"}
        </Pill>
      </div>
    </div>
  );
}
