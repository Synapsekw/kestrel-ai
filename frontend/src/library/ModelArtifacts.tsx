import { useEffect, useState } from "react";
import type { Model } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { artifactUrl, fetchResultsCsv } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { Alert, Skeleton } from "@/ui";
import { parseResultsCsv, type CurvePoint } from "./resultsCsv";
import { TrainingCurve } from "./TrainingCurve";

interface CsvState {
  modelId: string;
  points: CurvePoint[];
  error: string | null;
}

/** Mounted with `key={src}` so a new source starts un-failed without an effect. */
function ArtifactImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="flex flex-col gap-1">
      {failed ? (
        <span className="rounded-md bg-well px-2 py-6 text-center text-xs text-muted">
          {alt} not available
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="w-full rounded-md border border-line bg-panel"
        />
      )}
      <figcaption className="text-xs text-muted">{alt}</figcaption>
    </figure>
  );
}

export function ModelArtifacts({ projectId, model }: { projectId: string; model: Model }) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const hasCsv = Boolean(model.artifacts.results_csv);
  const [csv, setCsv] = useState<CsvState | null>(null);

  useEffect(() => {
    if (!hasCsv) return;
    let cancelled = false;
    fetchResultsCsv(api, projectId, model.id)
      .then((text) => {
        if (!cancelled) setCsv({ modelId: model.id, points: parseResultsCsv(text), error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`results.csv of ${model.id} failed: ${messageOf(e, String(e))}`);
        setCsv({ modelId: model.id, points: [], error: messageOf(e, "could not load results.csv") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, model.id, hasCsv]);

  const { confusion_matrix, pr_curve } = model.artifacts;
  if (!hasCsv && !confusion_matrix && !pr_curve) {
    return <p className="text-sm text-muted">No training artifacts (imported weights).</p>;
  }
  const curve = csv && csv.modelId === model.id ? csv : null;
  const cmSrc = confusion_matrix
    ? artifactUrl(baseUrl, token, projectId, model.id, "confusion_matrix")
    : null;
  const prSrc = pr_curve ? artifactUrl(baseUrl, token, projectId, model.id, "pr_curve") : null;
  return (
    <div className="flex flex-col gap-3">
      {hasCsv &&
        (curve ? (
          curve.error ? (
            <Alert tone="danger">{curve.error}</Alert>
          ) : (
            <div className="max-w-xl rounded-lg border border-line bg-panel p-3">
              <TrainingCurve points={curve.points} />
            </div>
          )
        ) : (
          <div role="status" aria-label="Loading results.csv" className="max-w-xl">
            <Skeleton className="h-[200px] w-full rounded-lg" />
          </div>
        ))}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cmSrc && <ArtifactImage key={cmSrc} src={cmSrc} alt="Confusion matrix" />}
        {prSrc && <ArtifactImage key={prSrc} src={prSrc} alt="PR curve" />}
      </div>
    </div>
  );
}
