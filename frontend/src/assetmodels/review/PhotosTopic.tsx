// src/assetmodels/review/PhotosTopic.tsx
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { thumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { Alert, Button, EmptyState, Field, MenuButton, Select, Skeleton, Switch, TopicPanel } from "@/ui";
import { OUTCOME_KEYS, OUTCOME_LABEL } from "./outcome";
import type { ReviewActions } from "./useReviewActions";
import type { PhotosLayer } from "./usePhotosLayer";

const n = (x: number) => x.toLocaleString("en-US");
const photos = (x: number) => `${n(x)} ${x === 1 ? "photo" : "photos"}`;

/** Spec §9 Photos: sequence, outcome colours, context photos, cameras and the view cone. */
export function PhotosTopic({
  projectId,
  layer,
  actions,
}: {
  projectId: string;
  layer: PhotosLayer;
  actions: ReviewActions;
}) {
  const backend = useBackend();
  const estimating = actions.running.pose;
  const menu = (
    <MenuButton
      label="Photos actions"
      iconOnly
      size="sm"
      items={[
        {
          id: "estimate",
          label: "Estimate poses from photo metadata",
          icon: "camera",
          disabled: estimating,
          hint: estimating ? "Running" : undefined,
          onSelect: () => void actions.estimate(),
        },
      ]}
    />
  );
  const empty = layer.done && layer.loaded === 0 && !layer.error;
  return (
    <TopicPanel
      title="Photos"
      count={layer.loaded > 0 ? photos(layer.shown.length) : null}
      menu={menu}
      filters={
        <div className="flex flex-col gap-2.5">
          {layer.sequences.length > 0 && (
            <Field label="Sequence" htmlFor="photos-sequence">
              <Select
                id="photos-sequence"
                dense
                value={layer.sequence ?? ""}
                onChange={(e) => layer.setSequence(e.target.value || null)}
              >
                <option value="">All sequences</option>
                {layer.sequences.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Switch
            label="Include context photos"
            checked={layer.includeContext}
            onChange={layer.setIncludeContext}
          />
          <Switch label="Show cameras" checked={layer.camerasOn} onChange={layer.setCamerasOn} />
          <Switch
            label="View cone"
            checked={layer.cone}
            disabled={!layer.camerasOn}
            onChange={layer.setCone}
          />
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
        {layer.error && (
          <Alert
            tone="danger"
            actions={
              <Button size="sm" icon="refresh" onClick={layer.reload}>
                Retry
              </Button>
            }
          >
            The photo poses could not be loaded. {layer.error}
          </Alert>
        )}
        {!layer.done && <Skeleton className="h-4 w-40" />}
        {empty ? (
          <EmptyState
            icon="camera"
            title="No photo poses yet"
            action={
              <Button
                size="sm"
                variant="primary"
                icon="camera"
                disabled={estimating}
                onClick={() => void actions.estimate()}
              >
                Estimate poses
              </Button>
            }
          >
            Poses come from each photo&apos;s GPS and gimbal data, or from an imported review job.
          </EmptyState>
        ) : (
          <>
            <ul aria-label="Photo outcomes" className="flex flex-col gap-1">
              {OUTCOME_KEYS.map((k) => (
                <li
                  key={k}
                  className="flex items-center gap-2 text-sm"
                  style={{ "--c": layer.colours[k] } as CSSProperties}
                >
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--c)]" />
                  <span className="flex-1 text-muted">{OUTCOME_LABEL[k]}</span>
                  <span className="font-mono text-2xs tabular-nums text-muted">{n(layer.counts[k])}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {layer.selected && (
          <section aria-label="Selected photo" className="flex flex-col gap-2 border-t border-line pt-3">
            <img
              alt=""
              className="aspect-[4/3] w-full rounded-control bg-surface-2 object-cover"
              src={thumbnailUrl(backend.baseUrl, backend.token, projectId, layer.selected.imageId)}
            />
            {layer.selected.sequence && <p className="text-xs text-muted">{layer.selected.sequence}</p>}
            <div className="flex flex-wrap gap-1.5">
              {layer.viewing ? (
                <Button size="sm" icon="orbit" onClick={() => layer.viewFrom(null)}>
                  Back to the model view
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon="camera"
                  onClick={() => layer.selected && layer.viewFrom(layer.selected)}
                >
                  View from here
                </Button>
              )}
              <Link
                to={`/p/${projectId}/images/${layer.selected.imageId}`}
                className="inline-flex items-center rounded-control px-2 text-sm text-accent-ink hover:underline"
              >
                Open photo
              </Link>
            </div>
          </section>
        )}
      </div>
    </TopicPanel>
  );
}
