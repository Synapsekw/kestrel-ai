import { useState } from "react";
import { messageOf } from "@/api/errors";
import { Alert, Button, Dialog } from "@/ui";

export function ConfirmDeleteDialog({
  title,
  body,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(messageOf(e, "Could not delete it."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{body}</p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Dialog>
  );
}
