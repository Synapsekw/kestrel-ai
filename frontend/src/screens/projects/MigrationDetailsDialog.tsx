import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { revealProjectBackup } from "@/api/migrations";
import { Button, Dialog, toast } from "@/ui";

/**
 * "Couldn't upgrade" details (F §9.2, §11.3). The database was not changed: the copy under
 * backups\ is the pre-upgrade state. Restoring it is a manual step (F §11.3 "Restore").
 */
export function MigrationDetailsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const api = useApi();
  const backup = project.migration.backup_path ?? null;
  async function reveal() {
    try {
      await revealProjectBackup(api, project.folder);
    } catch (e) {
      toast("danger", messageOf(e, "could not show the backup"));
    }
  }
  async function copy() {
    if (!backup) return;
    try {
      await navigator.clipboard.writeText(backup);
      toast("ok", "Backup path copied");
    } catch {
      toast("danger", "Could not copy the path");
    }
  }
  return (
    <Dialog
      open
      title={`${project.name} could not be upgraded`}
      onClose={onClose}
      footer={
        <>
          {backup && (
            <>
              <Button icon="folder" onClick={() => void reveal()}>
                Reveal backup
              </Button>
              <Button variant="ghost" onClick={() => void copy()}>
                Copy backup path
              </Button>
            </>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          The project was left as it was. Retry runs the upgrade again from the step that failed.
        </p>
        <p className="rounded-control bg-field p-3 font-mono text-xs text-ink">
          {project.migration.error ?? "No message."}
        </p>
        {backup && (
          <p className="text-muted">
            A copy taken before the upgrade is at{" "}
            <span className="break-all font-mono text-xs text-ink">{backup}</span>.
          </p>
        )}
      </div>
    </Dialog>
  );
}
