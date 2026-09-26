import { useState, type FormEvent } from "react";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Dialog } from "@/ui";
import { FolderField } from "./FolderField";

/** Opens a folder that holds a project; also "Locate folder…" for a project whose folder moved. */
export function OpenFolderDialog({
  onClose,
  onOpened,
  title = "Open a project folder",
  submitLabel = "Open project",
}: {
  onClose: () => void;
  onOpened: (p: Project) => void;
  title?: string;
  submitLabel?: string;
}) {
  const api = useApi();
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!folder.trim()) return setError("Choose the project folder to open.");
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await api.POST("/api/v1/projects/open", {
        body: { folder: folder.trim() },
      });
      if (data) onOpened(data);
      else setError(messageOf(err, "could not open the folder"));
    } catch (e2) {
      pushLog(`open folder failed: ${e2}`);
      setError(String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="folder" loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FolderField
          id="open-folder"
          label="Folder"
          value={folder}
          onChange={setFolder}
          hint="A folder that holds a project.db."
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
