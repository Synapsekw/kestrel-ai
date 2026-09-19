import { useState, type ReactNode } from "react";
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

const btn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40";

export function EditorToolbar(p: ToolbarProps) {
  const saving = p.pending > 0;
  const [keysOpen, setKeysOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-sm">
      {p.lead}
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
      <div className="relative">
        <button
          type="button"
          className={btn}
          aria-label="Keyboard shortcuts"
          aria-expanded={keysOpen}
          onClick={() => setKeysOpen((v) => !v)}
        >
          Keys
        </button>
        {keysOpen && (
          <div
            role="dialog"
            aria-label="Keyboard shortcuts"
            onKeyDown={(e) => e.key === "Escape" && setKeysOpen(false)}
            className="absolute left-0 top-full z-20 mt-1 w-80 rounded border border-slate-700 bg-slate-900 p-3 text-xs shadow-lg"
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {HOTKEY_HELP.map((h) => (
                <div key={h.keys} className="contents">
                  <dt className="font-mono text-slate-200">{h.keys}</dt>
                  <dd className="text-slate-400">{h.does}</dd>
                </div>
              ))}
            </dl>
            <button type="button" autoFocus className={`${btn} mt-2`} onClick={() => setKeysOpen(false)}>
              Close
            </button>
          </div>
        )}
      </div>
      <span role="status" className={`ml-auto text-xs ${saving ? "text-amber-300" : "text-slate-500"}`}>
        {saving ? "Saving…" : "Saved"}
      </span>
    </div>
  );
}
