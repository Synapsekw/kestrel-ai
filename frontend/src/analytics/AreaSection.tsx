import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AreaAnalytics } from "@/api/analytics";
import type { SurveyTimeline } from "@/api/surveys";
import { SurveyChart } from "@/surveys/SurveyChart";
import { Alert, Button, EmptyState, Field, Pill, Select, SkeletonRows } from "@/ui";
import { ClassLegend } from "./ClassLegend";
import { areaTimeline, countText, toggled } from "./format";
import { Section } from "./Section";

/** Site area by class for one survey, and one area's trend across the surveys that cover it. */
export function AreaSection({
  projectId,
  areas,
  error,
  classes,
  verifiedOnly,
}: {
  projectId: string;
  areas: AreaAnalytics | null;
  error: string | null;
  classes: SurveyTimeline["classes"];
  verifiedOnly: boolean;
}) {
  const navigate = useNavigate();
  const [surveyPick, setSurveyPick] = useState<string | null>(null);
  const [areaPick, setAreaPick] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const surveys = useMemo(() => areas?.surveys ?? [], [areas]);
  const newestFirst = [...surveys].reverse();
  const survey = surveys.find((s) => s.map_id === surveyPick) ?? newestFirst[0] ?? null;
  const areaList = areas?.areas ?? [];
  const trendId = areaList.find((a) => a.id === areaPick)?.id ?? areaList[0]?.id ?? null;
  const trend = useMemo(
    () => (areas && trendId ? areaTimeline(areas, trendId, classes, verifiedOnly) : null),
    [areas, trendId, classes, verifiedOnly],
  );
  // Only classes with a count somewhere get a column: an area table stays narrow.
  const shown = classes.filter((c) =>
    surveys.some((s) => Object.values(s.per_area).some((cell) => cell.counts[c.id])),
  );

  return (
    <Section
      title="Per site area"
      testId="area-section"
      intro="Objects inside each site area. An object counts in an area when the centre of its box is inside it."
      controls={
        surveys.length > 0 &&
        areaList.length > 0 && (
          <Field label="Survey" htmlFor="analytics-survey">
            <Select
              id="analytics-survey"
              wrapperClassName="w-56"
              value={survey?.map_id ?? ""}
              onChange={(e) => setSurveyPick(e.target.value)}
            >
              {newestFirst.map((s) => (
                <option key={s.map_id} value={s.map_id}>
                  {s.map_name} ({s.captured_on ?? "date not set"})
                </option>
              ))}
            </Select>
          </Field>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!areas && !error && <SkeletonRows rows={2} columns={3} />}
      {areas && areaList.length === 0 && (
        <EmptyState
          icon="map"
          title="No site areas yet"
          action={
            <Button size="sm" icon="map" onClick={() => navigate(`/p/${projectId}/site-areas`)}>
              Outline a site area
            </Button>
          }
        >
          Outline parts of the site, such as a laydown yard, to count the objects in each one.
        </EmptyState>
      )}
      {areas && areaList.length > 0 && surveys.length === 0 && (
        <p className="text-sm text-muted">No map has been counted yet.</p>
      )}
      {survey && areaList.length > 0 && (
        <div className="flex flex-col gap-8">
          {survey.state !== "ok" && (
            <Alert tone="warn">
              {survey.state === "not_counted"
                ? "This survey has not been counted yet."
                : "This survey was counted with another model or confidence, so it is not compared."}
            </Alert>
          )}
          <div className="overflow-x-auto">
            <table data-testid="area-table" className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 font-medium">Site area</th>
                  {shown.map((c) => (
                    <th key={c.id} className="font-medium">
                      {c.name}
                    </th>
                  ))}
                  <th className="font-medium">Cover</th>
                </tr>
              </thead>
              <tbody>
                {areaList.map((a) => {
                  const cell = survey.per_area[a.id];
                  return (
                    <tr key={a.id} className="border-t border-line">
                      <td className="py-2 text-ink">{a.name}</td>
                      {cell ? (
                        shown.map((c) => (
                          <td key={c.id} className="tabular-nums text-ink">
                            {countText(
                              cell.counts[c.id]?.total ?? 0,
                              cell.counts[c.id]?.verified ?? 0,
                              verifiedOnly,
                            )}
                          </td>
                        ))
                      ) : (
                        <td colSpan={Math.max(shown.length, 1)} className="text-muted">
                          not on this map
                        </td>
                      )}
                      <td>{cell?.partial && <Pill tone="warn">partly covered</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Trend in one area</h3>
              <Field label="Area" htmlFor="analytics-area">
                <Select
                  id="analytics-area"
                  wrapperClassName="w-56"
                  value={trendId ?? ""}
                  onChange={(e) => setAreaPick(e.target.value)}
                >
                  {areaList.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {trend && trend.surveys.length > 1 ? (
              <div data-testid="area-trend">
                <SurveyChart timeline={trend} hidden={hidden} />
                <ClassLegend
                  classes={classes}
                  hidden={hidden}
                  onToggle={(id) => setHidden((h) => toggled(h, id))}
                />
              </div>
            ) : (
              <p className="text-sm text-muted">A trend needs two surveys that cover this area.</p>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
