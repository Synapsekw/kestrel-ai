import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { revealInExplorer } from "@/api/exports";
import { pushLog } from "@/app/diagnostics";
import { Button, cx } from "@/ui";

interface Props {
  projectId: string;
  /** Project-relative path to a file or folder (M3: next to the weights path and each export). */
  path: string;
  className?: string;
}

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
      <Button size="sm" icon="external" className={cx(className)} loading={busy} onClick={() => void show()}>
        Show in folder
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
