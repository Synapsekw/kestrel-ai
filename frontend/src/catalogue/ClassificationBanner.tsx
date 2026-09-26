import { useState } from "react";
import { useApi } from "@/api/client";
import { finishClassification } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button } from "@/ui";

export interface ClassificationBannerProps {
  /** Non-archived migrated types (`migratedCount`). */
  count: number;
  /** The table shows only migrated types. */
  filtered: boolean;
  onShowAll: () => void;
  onShowMigrated: () => void;
  onDone: () => void;
}

/** F §7.5 / F4: migrated types start as objects; the operator marks the defects once. */
export function ClassificationBanner({
  count,
  filtered,
  onShowAll,
  onShowMigrated,
  onDone,
}: ClassificationBannerProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function done() {
    setBusy(true);
    setError(null);
    try {
      await finishClassification(api);
      onDone();
    } catch (e) {
      pushLog(`finish classification failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not save that"));
    } finally {
      setBusy(false);
    }
  }

  const title =
    count === 1
      ? "1 type came from your existing projects. Mark which are defects."
      : `${count} types came from your existing projects. Mark which are defects.`;

  return (
    <Alert
      tone="info"
      title={title}
      actions={
        <>
          {filtered ? (
            <Button size="sm" variant="ghost" onClick={onShowAll}>
              Show all types
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onShowMigrated}>
              Show them
            </Button>
          )}
          <Button size="sm" loading={busy} onClick={() => void done()}>
            Done
          </Button>
        </>
      }
    >
      Open a type and set its kind to Defect. You can then create findings from its accepted annotations.
      {error && (
        <span role="alert" className="mt-1 block text-danger">
          {error}
        </span>
      )}
    </Alert>
  );
}
