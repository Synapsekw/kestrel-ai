import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { revealInExplorer } from "@/api/exports";
import { pushLog } from "@/app/diagnostics";

interface Props {
  projectId: string;
  /** Project-relative path to a file or folder (M3: next to the weights path and each export). */
  path: string;
  className?: string;
}

const DEFAULT_CLASS =
  "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-50";

/** "Show in folder": opens Explorer on `path`; a reveal failure is an inline alert with the backend message. */
export function RevealButton({ projectId, path, className }: Props) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setBusy(true);
    setError(null);
    try {
      await revealInExplorer(api, projectId, path);
    } catch (e) {
      pushLog(`reveal ${path} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not open Explorer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={className ?? DEFAULT_CLASS}
        disabled={busy}
        onClick={() => void show()}
      >
        Show in folder
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-300">
          {error}
        </span>
      )}
    </span>
  );
}
