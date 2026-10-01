import { useMemo, useState } from "react";
import { useApi } from "@/api/client";
import { openAddData } from "@/data/addDataTiles";
import { setImportPrefill } from "@/mapws/drawings/importPrefill";
import { slotImports, useSetupImports } from "@/setup/dispatch";
import { Alert, Button } from "@/ui";

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const ROW = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1";

/**
 * The new project's setup imports on its Overview (spec §7.4, decision S1-7): "starting" while the
 * requests go out; then every failed import under its slot with Retry, and every drawing that needs
 * a choice with Finish drawing import. Nothing once every import has started: the Jobs card follows
 * them from there.
 */
export function SetupNotice({ projectId }: { projectId: string }) {
  const api = useApi();
  const entry = useSetupImports((s) => s.byProject[projectId]);
  const slots = useMemo(() => slotImports(entry), [entry]);
  const [busy, setBusy] = useState<string | null>(null);
  if (!entry) return null;

  const failed = entry.units.filter((u) => u.state === "failed").length;
  const choices = entry.units.filter((u) => u.state === "needs_choice" && u.route === "drawing");
  const pending = entry.units.filter((u) => u.state === "pending").length;
  const notStarted = entry.omitted.reduce((n, o) => n + o.count, 0);

  if (failed === 0 && choices.length === 0 && notStarted === 0) {
    if (pending === 0) return null;
    return (
      <Alert
        tone="info"
        testId="setup-notice"
        title={`Setup: starting ${count(pending, "import", "imports")}…`}
      />
    );
  }

  async function retry(slotKey: string) {
    setBusy(slotKey);
    try {
      await useSetupImports.getState().retry(api, projectId, slotKey);
    } finally {
      setBusy(null);
    }
  }

  function finish(path: string) {
    setImportPrefill(path);
    openAddData("drawing");
  }

  const title = [
    failed > 0 ? `${count(failed, "import", "imports")} failed` : null,
    choices.length > 0 ? `${count(choices.length, "drawing needs", "drawings need")} your choice` : null,
    notStarted > 0 ? `${count(notStarted, "file", "files")} not started` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Alert
      tone="warn"
      testId="setup-notice"
      title={`Setup: ${title}`}
      onDismiss={() => useSetupImports.getState().dismiss(projectId)}
    >
      <ul className="mt-2 flex flex-col gap-1.5">
        {slots
          .filter((s) => s.failed > 0)
          .map((s) => (
            <li key={s.slotKey} className={ROW}>
              <span className="font-medium text-ink">{s.label}</span>
              <span className="min-w-0 break-words text-muted">{s.error}</span>
              <Button
                size="sm"
                icon="refresh"
                aria-label={`Retry ${s.label}`}
                loading={busy === s.slotKey}
                disabled={busy !== null}
                onClick={() => void retry(s.slotKey)}
              >
                Retry
              </Button>
            </li>
          ))}
        {choices.map((u) => (
          <li key={u.id} className={ROW}>
            <span className="font-medium text-ink">{fileName(u.path)}</span>
            <span className="min-w-0 break-words text-muted">{u.error}</span>
            <Button size="sm" onClick={() => finish(u.path)}>
              Finish drawing import
            </Button>
          </li>
        ))}
        {entry.omitted.map((o) => (
          <li key={`${o.slotKey}:${o.folder}`} className="text-muted">
            {`${o.count === 1 ? `1 more file in ${o.folder} was` : `${o.count} more files in ${o.folder} were`} not started — import them from the ${o.tab} tab`}
          </li>
        ))}
      </ul>
    </Alert>
  );
}
