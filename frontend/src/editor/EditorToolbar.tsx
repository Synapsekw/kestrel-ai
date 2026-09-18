import type { ReactNode } from "react";
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
}

const btn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40";
const KEYS_TITLE = HOTKEY_HELP.map((h) => `${h.keys}: ${h.does}`).join("\n");

export function EditorToolbar(p: ToolbarProps) {
  const saving = p.pending > 0;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-sm">
      <button
        type="button"
        className={btn}
        onClick={p.onPrev}
        title="Ctrl+Left"
        disabled={!p.position || p.position.index <= 0}
      >
        Previous
      </button>
      <button
        type="button"
        className={btn}
        onClick={p.onNext}
        title="Ctrl+Right"
        disabled={!p.position || p.position.index >= p.position.count - 1}
      >
        Next
      </button>
      {p.position && p.position.index >= 0 && (
        <span className="text-xs text-slate-400" data-testid="position">
          {p.position.index + 1} / {p.position.count}
        </span>
      )}
      <span className="min-w-0 truncate text-slate-300">{p.fileName}</span>
      <span className="mx-1 h-4 border-l border-slate-700" />
      <button type="button" className={btn} onClick={p.onFit} title="F">
        Fit
      </button>
      <button type="button" className={btn} onClick={p.onOneToOne} title="0 or Ctrl+1">
        1:1
      </button>
      <span className="w-12 text-xs tabular-nums text-slate-400" data-testid="zoom">
        {Math.round(p.zoom * 100)}%
      </span>
      <span className="mx-1 h-4 border-l border-slate-700" />
      {/* Undo/redo wait for in-flight saves: a compensating call must target settled state. */}
      <button type="button" className={btn} onClick={p.onUndo} disabled={!p.canUndo || saving} title="Ctrl+Z">
        Undo
      </button>
      <button type="button" className={btn} onClick={p.onRedo} disabled={!p.canRedo || saving} title="Ctrl+Y">
        Redo
      </button>
      {p.extra}
      <button
        type="button"
        className="cursor-help rounded px-1 text-xs text-slate-500 hover:text-slate-300 focus:ring-1 focus:ring-orange-500"
        title={KEYS_TITLE}
        aria-label="Keyboard shortcuts"
      >
        Keys
      </button>
      <span role="status" className={`ml-auto text-xs ${saving ? "text-amber-300" : "text-slate-500"}`}>
        {saving ? "Saving…" : "Saved"}
      </span>
    </div>
  );
}
