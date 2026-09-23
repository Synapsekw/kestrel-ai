import { useMemo, useState } from "react";
import type { Source } from "@contract/client";
import { useApi } from "@/api/client";
import { fetchSourceAnalytics, type SourceAnalytics } from "@/api/analytics";
import { Alert, EmptyState, Field, Pill, Select, SkeletonRows } from "@/ui";
import { ClassCountTable } from "./ClassCountTable";
import { reviewText, sortSources } from "./format";
import { Section } from "./Section";
import { useLoad } from "./useLoad";

const sourceName = (s: Source) => s.label ?? s.folder;

function Summary({ a }: { a: SourceAnalytics }) {
  const run = a.run;
  const what =
    a.unit === "objects"
      ? "Objects on the map"
      : `Detections across ${a.image_count ?? 0} photos; one object can appear in several photos`;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-ink">{what}.</p>
      {run && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
          <span>
            {run.model_name ?? "Unknown model"} at confidence {run.conf}
          </span>
          <span>{a.source.captured_on ?? "date not set"}</span>
          <span className="tabular-nums">{reviewText(a.review)}</span>
          {run.pinned && <Pill size="sm">pinned</Pill>}
        </p>
      )}
    </div>
  );
}

/** One source's class counts from the run that speaks for it. */
export function SourceSection({
  projectId,
  sources,
  verifiedOnly,
  reloadKey,
}: {
  projectId: string;
  sources: Source[] | null;
  verifiedOnly: boolean;
  reloadKey: number;
}) {
  const api = useApi();
  const sorted = useMemo(() => sortSources(sources ?? []), [sources]);
  const [picked, setPicked] = useState<string | null>(null);
  const sourceId = picked && sorted.some((s) => s.id === picked) ? picked : (sorted[0]?.id ?? null);
  const { data, error } = useLoad(sourceId ? `${sourceId}|${reloadKey}` : null, () =>
    fetchSourceAnalytics(api, projectId, sourceId!),
  );
  const current = data && data.source.id === sourceId ? data : null;

  return (
    <Section
      title="Per source"
      testId="source-section"
      intro="The counts of one photo batch or map, from its pinned run or else its newest."
      controls={
        sorted.length > 0 && (
          <Field label="Source" htmlFor="analytics-source">
            <Select
              id="analytics-source"
              wrapperClassName="w-64"
              value={sourceId ?? ""}
              onChange={(e) => setPicked(e.target.value)}
            >
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  {sourceName(s)} ({s.kind === "map" ? "map" : "photos"})
                </option>
              ))}
            </Select>
          </Field>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {sources && sorted.length === 0 && (
        <EmptyState icon="images" title="No sources yet">
          Add photos or a map, then run a model over them.
        </EmptyState>
      )}
      {sorted.length > 0 && !current && !error && <SkeletonRows rows={2} columns={2} />}
      {current && (
        <div className="flex flex-col gap-4">
          <Summary a={current} />
          {current.run === null ? (
            <p className="text-sm text-muted">No run yet. Run a model on this source to count it.</p>
          ) : current.classes.length === 0 ? (
            <p className="text-sm text-muted">The run found nothing.</p>
          ) : (
            <ClassCountTable
              testId="source-table"
              rows={current.classes}
              unit={current.unit}
              verifiedOnly={verifiedOnly}
            />
          )}
        </div>
      )}
    </Section>
  );
}
