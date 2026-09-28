import { useMemo, useState, type FormEvent } from "react";
import type { CatalogueType } from "@/api/catalogue";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import {
  createLibraryDataset,
  type DatasetFilter,
  type DatasetPreview,
  type DatasetTask,
  type LibraryDataset,
} from "@/api/libraryDatasets";
import { useRecentProjects } from "@/api/recentProjects";
import { pushLog } from "@/app/diagnostics";
import { useCatalogue } from "@/catalogue/useCatalogue";
import { useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  Checkbox,
  Disclosure,
  Field,
  GlassPanel,
  Input,
  Segmented,
  Select,
  Skeleton,
} from "@/ui";
import {
  emptyBuilderForm,
  MAX_DATASET_TYPES,
  skippedReason,
  toCreateBody,
  toFilter,
  validateBuilder,
  type BuilderForm,
} from "./builderModel";
import { SPLIT_LABEL } from "./datasetLabels";
import { useDatasetPreview } from "./useDatasetPreview";

export interface DatasetBuilderProps {
  initialProjectIds: string[];
  initialTypeIds: string[];
  onCreated: (dataset: LibraryDataset) => void;
  onClose: () => void;
}

const TASKS: { value: DatasetTask; label: string }[] = [
  { value: "detect", label: "Boxes" },
  { value: "obb", label: "Rotated boxes" },
  { value: "segment", label: "Polygons" },
];

/** What a project's preview row says instead of a count. */
const PROJECT_STATE: Record<Exclude<DatasetPreview["projects"][number]["state"], "ok">, string> = {
  timed_out: "still counting",
  missing: "folder not found",
  unavailable: "cannot open",
};

const toggle = (ids: string[], id: string, on: boolean) =>
  on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id);

function PreviewPanel({
  filter,
  preview,
  loading,
  error,
  types,
  task,
  boxesAsPolygons,
}: {
  filter: DatasetFilter | null;
  preview: DatasetPreview | null;
  loading: boolean;
  error: string | null;
  types: CatalogueType[];
  task: DatasetTask;
  boxesAsPolygons: boolean;
}) {
  if (!filter) {
    return (
      <aside
        aria-label="Preview"
        className="rounded-panel border border-line bg-surface-2 p-4 text-sm text-muted"
      >
        Choose projects and types to count the images.
      </aside>
    );
  }
  return (
    <aside
      aria-label="Preview"
      aria-busy={loading}
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface-2 p-4"
    >
      <span className="text-xs text-muted">Images with labels</span>
      <span data-testid="preview-images" className="text-kpi font-semibold tabular-nums">
        {preview ? preview.images : "–"}
      </span>
      {loading && <span className="text-xs text-muted">Counting…</span>}
      {error && <Alert tone="danger">{error}</Alert>}
      {preview && preview.images === 0 && <Alert tone="warn">No labelled images match this filter.</Alert>}
      {preview && preview.skipped_by_task > 0 && (
        <Alert tone="warn">
          {`${preview.skipped_by_task} of ${preview.images} images will be skipped: ${skippedReason(task, boxesAsPolygons)}.`}
        </Alert>
      )}
      {preview && (
        <ul data-testid="preview-types" className="flex flex-col gap-1 text-sm">
          {filter.type_ids.map((id) => (
            <li key={id} className="flex items-baseline justify-between gap-3">
              <span className="truncate">{types.find((t) => t.id === id)?.name ?? "Unknown type"}</span>
              <span className="font-mono tabular-nums">{preview.boxes_per_type[id] ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <ul
          data-testid="preview-projects"
          className="flex flex-col gap-1 border-t border-line pt-2 text-xs text-muted"
        >
          {preview.projects.map((p) => (
            <li key={p.project_id} className="flex items-baseline justify-between gap-3">
              <span className="truncate">{p.project_name}</span>
              <span className="font-mono tabular-nums">
                {p.state === "ok" ? p.images : PROJECT_STATE[p.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {preview?.projects.some((p) => p.state === "timed_out") && (
        <p className="text-xs text-muted">
          Some projects took longer than 2 s to count. The build still includes them.
        </p>
      )}
      {preview?.projects.some((p) => p.state === "missing" || p.state === "unavailable") && (
        <p className="text-xs text-warn">
          A project that cannot be opened now makes the build fail. Untick it, or open it first.
        </p>
      )}
    </aside>
  );
}

/** F §12.4: projects, types, dates, reviewed-only, task and split, with live counts. */
export function DatasetBuilder({
  initialProjectIds,
  initialTypeIds,
  onCreated,
  onClose,
}: DatasetBuilderProps) {
  const api = useApi();
  const recent = useRecentProjects();
  const { projects } = recent;
  const catalogue = useCatalogue();
  const liveTypes = useMemo(() => catalogue.types.filter((t) => !t.archived), [catalogue.types]);
  const [form, setForm] = useState<BuilderForm>(() => emptyBuilderForm(initialProjectIds, initialTypeIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filter = useMemo(() => toFilter(form), [form]);
  const preview = useDatasetPreview(filter, form.task);
  const patch = (p: Partial<BuilderForm>) => setForm((f) => ({ ...f, ...p }));
  const nothingMatches =
    preview.preview !== null && preview.preview.images - preview.preview.skipped_by_task <= 0;
  const canCreate = !catalogue.unavailable && !nothingMatches && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateBuilder(form);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const { dataset, job } = await createLibraryDataset(api, toCreateBody(form));
      useJobsStore.getState().upsert(job);
      onCreated(dataset);
    } catch (err) {
      pushLog(`create dataset failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not create the dataset"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassPanel variant="pane" className="p-5">
      <form
        aria-label="New dataset"
        noValidate
        onSubmit={(e) => void submit(e)}
        className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="text-lg font-semibold">New dataset</h3>
          <Field label="Name" htmlFor="ds-name" className="max-w-sm">
            <Input id="ds-name" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-muted">Projects</legend>
            {recent.loading ? (
              <Skeleton className="h-4 w-48" />
            ) : recent.error ? (
              <Alert tone="danger" title="The project list could not be loaded">
                {recent.error}
              </Alert>
            ) : (
              projects.length === 0 && (
                <p className="text-sm text-muted">No recent projects. Open one from Projects first.</p>
              )
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {projects.map((p) => (
                <Checkbox
                  key={p.id}
                  label={p.name}
                  checked={form.projectIds.includes(p.id)}
                  onChange={(e) => patch({ projectIds: toggle(form.projectIds, p.id, e.target.checked) })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-muted">Types (the class order of the dataset)</legend>
            {catalogue.unavailable ? (
              <Alert tone="info">
                The catalogue is not available, so types cannot be chosen. Check the Catalogue section.
              </Alert>
            ) : (
              <>
                {catalogue.error && (
                  <Alert
                    tone="danger"
                    title="The catalogue could not be loaded"
                    actions={
                      <Button size="sm" onClick={catalogue.reload}>
                        Retry
                      </Button>
                    }
                  >
                    {catalogue.error}
                  </Alert>
                )}
                {catalogue.loading && <Skeleton className="h-4 w-64" />}
                {liveTypes.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() => patch({ typeIds: liveTypes.slice(0, MAX_DATASET_TYPES).map((t) => t.id) })}
                  >
                    Select all
                  </Button>
                )}
                {liveTypes.length > MAX_DATASET_TYPES && (
                  <p className="text-xs text-muted">
                    Select all picks the first {MAX_DATASET_TYPES} types: a dataset holds at most{" "}
                    {MAX_DATASET_TYPES}.
                  </p>
                )}
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {liveTypes.map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.name}
                      checked={form.typeIds.includes(t.id)}
                      onChange={(e) => patch({ typeIds: toggle(form.typeIds, t.id, e.target.checked) })}
                    />
                  ))}
                </div>
              </>
            )}
          </fieldset>

          <div className="grid max-w-md gap-4 sm:grid-cols-2">
            <Field label="Captured from" htmlFor="ds-from">
              <Input
                id="ds-from"
                type="date"
                value={form.from}
                onChange={(e) => patch({ from: e.target.value })}
              />
            </Field>
            <Field label="Captured to" htmlFor="ds-to">
              <Input id="ds-to" type="date" value={form.to} onChange={(e) => patch({ to: e.target.value })} />
            </Field>
          </div>

          <Checkbox
            label="Reviewed annotations only (accepted, edited or drawn by a person)"
            checked={form.reviewedOnly}
            onChange={(e) => patch({ reviewedOnly: e.target.checked })}
          />

          <div className="flex flex-col gap-1">
            <Segmented label="Task" options={TASKS} value={form.task} onChange={(task) => patch({ task })} />
            {form.task === "segment" && (
              <Checkbox
                label="Boxes as polygons (use boxes and rotated boxes as 4-point outlines)"
                checked={form.boxesAsPolygons}
                onChange={(e) => patch({ boxesAsPolygons: e.target.checked })}
              />
            )}
          </div>

          <Disclosure label="Split options">
            <div className="grid max-w-xl gap-4 sm:grid-cols-3">
              <Field label="Split method" htmlFor="ds-split">
                <Select
                  id="ds-split"
                  value={form.split}
                  onChange={(e) => patch({ split: e.target.value as BuilderForm["split"] })}
                >
                  {(Object.keys(SPLIT_LABEL) as BuilderForm["split"][]).map((m) => (
                    <option key={m} value={m}>
                      {SPLIT_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Validation fraction" htmlFor="ds-fraction">
                <Input
                  id="ds-fraction"
                  type="number"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={form.valFraction}
                  onChange={(e) => patch({ valFraction: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
              <Field label="Seed" htmlFor="ds-seed">
                <Input
                  id="ds-seed"
                  type="number"
                  value={form.seed}
                  onChange={(e) => patch({ seed: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
            </div>
            <p className="mt-2 text-xs text-muted">
              By flight keeps every image of one flight on the same side, so validation measures flights the
              model has not seen. Group keys include the project, so a flight never straddles train and
              validation.
            </p>
          </Disclosure>

          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={!canCreate}>
              Create dataset
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
        <PreviewPanel
          filter={filter}
          preview={preview.preview}
          loading={preview.loading}
          error={preview.error}
          types={catalogue.types}
          task={form.task}
          boxesAsPolygons={form.boxesAsPolygons}
        />
      </form>
    </GlassPanel>
  );
}
