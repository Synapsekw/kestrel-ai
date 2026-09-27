import { useEffect, useState, type CSSProperties } from "react";
import { useApi } from "@/api/client";
import { fetchSeverityScale, saveSeverityScale, severityInUse, type SeverityLevel } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, GlassPanel, Input, SkeletonRows, cx, transition } from "@/ui";
import { ColourSwatch } from "./ColourSwatch";
import { useCatalogueSeverity } from "./severityStore";
import {
  MAX_LEVELS,
  PREVIEW_COUNTS,
  appendLevel,
  removeTopLevel,
  severityInUseMessage,
  toLevels,
  validateLevels,
} from "./severityModel";

interface Loaded {
  key: string;
  levels: SeverityLevel[] | null;
  error: string | null;
}

/** The Severity sub-tab (F §7.5): an ordered list, Add level, Remove top level, and a live preview. */
export function SeverityEditor() {
  const api = useApi();
  const revision = useChangesStore((s) => s.catalogueRevision);
  const [attempt, setAttempt] = useState(0);
  const key = `${revision}|${attempt}`;
  const [loaded, setLoaded] = useState<Loaded>({ key: "", levels: null, error: null });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSeverityScale(api)
      .then((levels) => {
        if (!cancelled) setLoaded({ key, levels, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load severity scale failed: ${messageOf(e, String(e))}`);
        setLoaded((s) => ({
          key,
          levels: s.levels,
          error: messageOf(e, "could not load the severity scale"),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  if (loaded.levels === null) {
    return loaded.error ? (
      <Alert
        tone="danger"
        actions={
          <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </Button>
        }
      >
        {loaded.error}
      </Alert>
    ) : (
      <SkeletonRows rows={4} columns={3} />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {status && (
        <Alert tone="ok" role="status" onDismiss={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      <SeverityForm
        key={loaded.key}
        saved={loaded.levels}
        onSaved={(levels) => {
          setLoaded((s) => ({ ...s, levels }));
          setStatus("Severity scale saved");
        }}
        onEdited={() => setStatus(null)}
      />
    </div>
  );
}

function SeverityForm({
  saved,
  onSaved,
  onEdited,
}: {
  saved: SeverityLevel[];
  onSaved: (levels: SeverityLevel[]) => void;
  onEdited: () => void;
}) {
  const api = useApi();
  const [drafts, setDrafts] = useState<SeverityLevel[]>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved);

  const edit = (next: (d: SeverityLevel[]) => SeverityLevel[]) => {
    setDrafts(next);
    onEdited();
  };
  const update = (i: number, p: Partial<SeverityLevel>) =>
    edit((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));

  async function save() {
    const problem = validateLevels(drafts);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const levels = await saveSeverityScale(api, toLevels(drafts));
      useCatalogueSeverity.getState().setLevels(levels);
      onSaved(levels);
    } catch (e) {
      pushLog(`save severity scale failed: ${messageOf(e, String(e))}`);
      const inUse = severityInUse(e);
      setError(
        inUse ? severityInUseMessage(inUse, saved) : messageOf(e, "could not save the severity scale"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
      <GlassPanel variant="pane" className="flex flex-col gap-4 p-5">
        <ol aria-label="Severity levels" className="flex flex-col gap-2">
          {drafts.map((l, i) => (
            <li key={l.level} className="flex items-center gap-3">
              <span className="w-6 text-right font-mono text-sm tabular-nums text-muted">{l.level}</span>
              <ColourSwatch
                label={`Colour of level ${l.level}`}
                value={l.colour}
                onChange={(colour) => update(i, { colour })}
              />
              <Input
                aria-label={`Name of level ${l.level}`}
                value={l.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className="max-w-xs"
              />
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            icon="plus"
            size="sm"
            disabled={drafts.length >= MAX_LEVELS}
            onClick={() => edit(appendLevel)}
          >
            Add level
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={drafts.length <= 1}
            onClick={() => edit(removeTopLevel)}
          >
            Remove top level
          </Button>
        </div>
        <p className="text-xs text-muted">
          Only the highest level can be removed, and only while no open finding uses it. Keys 1 to{" "}
          {drafts.length} grade a finding.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-2">
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>
            Save scale
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => {
              setDrafts(saved);
              setError(null);
            }}
          >
            Reset
          </Button>
        </div>
      </GlassPanel>
      <SeverityPreview levels={drafts} />
    </div>
  );
}

/** The Overview's severity bars and pills, drawn from the drafts (colours are data: `--c`). */
function SeverityPreview({ levels }: { levels: SeverityLevel[] }) {
  const counts = levels.map((l) => PREVIEW_COUNTS[l.level - 1] ?? 1);
  const max = Math.max(1, ...counts);
  return (
    <GlassPanel variant="pane" className="p-5">
      <section aria-label="Severity preview" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Preview</h2>
        <div className="flex flex-col gap-2.5">
          {[...levels].reverse().map((l) => {
            const n = PREVIEW_COUNTS[l.level - 1] ?? 1;
            return (
              <div
                key={l.level}
                className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3 text-xs"
                style={{ "--c": l.colour } as CSSProperties}
              >
                <span className="truncate">{l.name || `Level ${l.level}`}</span>
                <span className="h-2 overflow-hidden rounded-chip bg-surface-2">
                  <span
                    className={cx("block h-full origin-left rounded-chip bg-[var(--c)]", transition)}
                    style={{ transform: `scaleX(${n / max})` }}
                  />
                </span>
                <span className="text-right font-mono tabular-nums text-muted">{n}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {levels.map((l) => (
            <span
              key={l.level}
              className="inline-flex items-center gap-1.5 rounded-chip bg-surface-2 px-2.5 py-0.5 text-2xs font-semibold"
              style={{ "--c": l.colour } as CSSProperties}
            >
              <span aria-hidden className="h-2 w-2 rounded-chip bg-[var(--c)]" />
              {l.name || `Level ${l.level}`}
            </span>
          ))}
        </div>
      </section>
    </GlassPanel>
  );
}
