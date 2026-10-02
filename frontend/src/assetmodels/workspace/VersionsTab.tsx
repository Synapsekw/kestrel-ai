import { useEffect, useState } from "react";
import type { AssetModelVersion } from "@contract/client";
import { getVersion } from "@/api/assetModels";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { diffSpecs, type SpecDiff } from "@/assetmodels/specDiff";
import { relativeTime } from "@/findings/format";
import { useNow } from "@/jobs/useNow";
import { Alert, Button, Checkbox, EmptyState, Pill, cx, focusRing, transition } from "@/ui";

/** "v3 · manual · Restored from version 1 · 2 min ago" */
function rowText(v: AssetModelVersion, now: number): string {
  return [`v${v.version}`, v.kind, v.note, relativeTime(v.created_at, now).replace(/ /g, "\u00a0")]
    .filter(Boolean)
    .join(" · ");
}

function DiffList({ from, to, diff }: { from: number; to: number; diff: SpecDiff }) {
  const empty = diff.added.length + diff.removed.length + diff.changed.length === 0;
  return (
    <section
      aria-label={`v${from} → v${to}`}
      className="flex flex-col gap-2 rounded-control border border-line bg-surface p-2.5 text-sm"
    >
      <h4 className="font-mono text-xs text-muted">{`v${from} → v${to}`}</h4>
      {empty && <p className="text-muted">The two versions have the same parts.</p>}
      {diff.added.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-ok">Added</h5>
          <p className="font-mono text-xs text-ink">{diff.added.join(", ")}</p>
        </div>
      )}
      {diff.removed.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-danger">Removed</h5>
          <p className="font-mono text-xs text-ink">{diff.removed.join(", ")}</p>
        </div>
      )}
      {diff.changed.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-warn">Changed</h5>
          <ul className="flex flex-col gap-0.5">
            {diff.changed.map((c) => (
              <li key={c.id} className="text-xs">
                <span className="font-mono text-ink">{c.id}</span>
                <span className="text-muted"> · {c.fields.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Loads the two picked versions' specs and diffs the older against the newer. */
function useComparison(projectId: string, modelId: string, pair: readonly number[]) {
  const api = useApi();
  const [result, setResult] = useState<{ key: string; diff: SpecDiff | null; error: string | null } | null>(
    null,
  );
  const [a, b] = [...pair].sort((x, y) => x - y);
  const key = pair.length === 2 ? `${a}/${b}` : "";
  useEffect(() => {
    if (!key) return;
    let live = true;
    Promise.all([getVersion(api, projectId, modelId, a), getVersion(api, projectId, modelId, b)]).then(
      ([x, y]) => live && setResult({ key, diff: diffSpecs(x.spec, y.spec), error: null }),
      (e: unknown) =>
        live && setResult({ key, diff: null, error: messageOf(e, "The versions could not be loaded.") }),
    );
    return () => {
      live = false;
    };
  }, [api, projectId, modelId, key, a, b]);
  return key && result?.key === key ? { from: a, to: b, ...result } : null;
}

/**
 * The model's versions, newest first: show one, restore an older one (a new version, nothing is
 * overwritten), or tick two to compare their parts.
 */
export function VersionsTab({
  projectId,
  modelId,
  versions,
  current,
  shown,
  onShow,
  onRestore,
  error = null,
  onRetry,
}: {
  projectId: string;
  modelId: string;
  versions: readonly AssetModelVersion[] | null;
  current: number | null;
  shown: number | null;
  onShow(version: number): void;
  onRestore(version: number): Promise<void>;
  /** The list could not be read; shown with a retry (never as "no versions"). */
  error?: string | null;
  onRetry?(): void;
}) {
  const now = useNow(60_000);
  const [pair, setPair] = useState<number[]>([]);
  const [restoring, setRestoring] = useState<number | null>(null);
  const comparison = useComparison(projectId, modelId, pair);
  const failed = error && (
    <Alert
      tone="danger"
      title="The versions could not be loaded."
      actions={
        onRetry && (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      <p className="text-xs text-muted">{error}</p>
    </Alert>
  );
  if (versions === null) return failed || <p className="p-2 text-sm text-muted">Loading the versions…</p>;
  if (versions.length === 0)
    return (
      <EmptyState icon="cube" title="No versions yet">
        Each build or edit saves a version here.
      </EmptyState>
    );
  const pick = (n: number, on: boolean) =>
    setPair((p) => (on ? [...p.filter((x) => x !== n), n].slice(-2) : p.filter((x) => x !== n)));
  return (
    <div className="flex flex-col gap-3">
      {failed}
      <ul aria-label="Versions" className="flex flex-col gap-1">
        {versions.map((v) => (
          <li
            key={v.version}
            className={cx(
              "flex items-start gap-2 rounded-sm px-2 py-1.5",
              v.version === shown ? "bg-accent-soft" : "hover:bg-hover",
              transition,
            )}
          >
            <Checkbox
              aria-label={`Compare v${v.version}`}
              className="mt-0.5"
              checked={pair.includes(v.version)}
              onChange={(e) => pick(v.version, e.target.checked)}
            />
            <button
              type="button"
              aria-current={v.version === shown ? "true" : undefined}
              onClick={() => onShow(v.version)}
              className={cx("min-w-0 flex-1 rounded-sm text-left text-sm text-ink", focusRing)}
            >
              <span className="block break-words">{rowText(v, now)}</span>
              {(v.version === current || v.glb_status !== "ready") && (
                <span className="mt-1 flex gap-1">
                  {v.version === current && (
                    <Pill size="sm" tone="accent">
                      current
                    </Pill>
                  )}
                  {v.glb_status === "pending" && (
                    <Pill size="sm" tone="neutral" live>
                      building
                    </Pill>
                  )}
                  {v.glb_status === "failed" && (
                    <Pill size="sm" tone="danger">
                      3D failed
                    </Pill>
                  )}
                </span>
              )}
            </button>
            {v.version !== current && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Restore v${v.version}`}
                loading={restoring === v.version}
                disabled={restoring !== null}
                onClick={() => {
                  setRestoring(v.version);
                  void onRestore(v.version).finally(() => setRestoring(null));
                }}
              >
                Restore
              </Button>
            )}
          </li>
        ))}
      </ul>
      {pair.length === 1 && <p className="px-2 text-xs text-muted">Tick a second version to compare.</p>}
      {comparison?.diff && <DiffList from={comparison.from} to={comparison.to} diff={comparison.diff} />}
      {comparison?.error && <p className="px-2 text-xs text-danger">{comparison.error}</p>}
    </div>
  );
}
