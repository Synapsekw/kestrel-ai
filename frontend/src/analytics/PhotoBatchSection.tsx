import type { PhotoBatchAnalytics } from "@/api/analytics";
import type { SurveyTimeline } from "@/api/surveys";
import { Alert, EmptyState, SkeletonRows } from "@/ui";
import { PHOTO_CAPTION, countText, reviewText } from "./format";
import { Section } from "./Section";

type Column = { id: string; name: string };

/** Photo batches: detections per class. Never summed into objects and never part of a trend. */
export function PhotoBatchSection({
  data,
  error,
  classes,
  verifiedOnly,
}: {
  data: PhotoBatchAnalytics | null;
  error: string | null;
  classes: SurveyTimeline["classes"];
  verifiedOnly: boolean;
}) {
  const batches = data?.batches ?? [];
  // Project class order first; a class the timeline does not list still gets its own column.
  const columns: Column[] = [];
  const seen = new Set(batches.flatMap((b) => b.classes.map((c) => c.class_id)));
  for (const c of classes) if (seen.has(c.id)) columns.push({ id: c.id, name: c.name });
  for (const b of batches)
    for (const c of b.classes)
      if (!columns.some((k) => k.id === c.class_id)) columns.push({ id: c.class_id, name: c.name });

  return (
    <Section title={PHOTO_CAPTION} testId="photo-section">
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <SkeletonRows rows={2} columns={4} />}
      {data && batches.length === 0 && (
        <EmptyState icon="images" title="No photo batches yet">
          Add a folder of photos as a source and run a model over it.
        </EmptyState>
      )}
      {batches.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 font-medium">Photo batch</th>
                <th className="font-medium">Date</th>
                <th className="text-right font-medium">Photos</th>
                {columns.map((c) => (
                  <th key={c.id} className="pl-4 font-medium">
                    {c.name}
                  </th>
                ))}
                <th className="pl-4 font-medium">Counted with</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const byClass = new Map(b.classes.map((c) => [c.class_id, c]));
                return (
                  <tr key={b.source.id} className="border-t border-line">
                    <td className="py-2 text-ink">{b.source.label ?? b.source.folder}</td>
                    <td className="text-muted">{b.source.captured_on ?? "date not set"}</td>
                    <td className="text-right tabular-nums text-muted">{b.source.image_count}</td>
                    {columns.map((c) => (
                      <td key={c.id} className="pl-4 tabular-nums text-ink">
                        {countText(
                          byClass.get(c.id)?.total ?? 0,
                          byClass.get(c.id)?.verified ?? 0,
                          verifiedOnly,
                        )}
                      </td>
                    ))}
                    <td className="pl-4 text-muted">
                      {b.run ? (
                        <>
                          {b.run.model_name ?? "Unknown model"} at {b.run.conf}
                          <span className="block text-xs tabular-nums">{reviewText(b.run.review)}</span>
                        </>
                      ) : (
                        "no run yet"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
