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
      <button type="button" className={btn} onClick={p.onUndo} disabled={!p.canUndo} title="Ctrl+Z">
        Undo
      </button>
      <button type="button" className={btn} onClick={p.onRedo} disabled={!p.canRedo} title="Ctrl+Y">
        Redo
      </button>
      {p.extra}
      <span className="cursor-help text-xs text-slate-500" title={KEYS_TITLE}>
        Keys
      </span>
      <span
        role="status"
        className={`ml-auto text-xs ${p.pending > 0 ? "text-amber-300" : "text-slate-500"}`}
      >
        {p.pending > 0 ? "Saving…" : "Saved"}
      </span>
    </div>
  );
}
