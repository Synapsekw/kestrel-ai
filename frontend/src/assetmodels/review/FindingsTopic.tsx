// src/assetmodels/review/FindingsTopic.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AssetModel } from "@contract/client";
import { formatFindingNumber } from "@/findings/format";
import { findingPath } from "@/findings/links";
import { useProjectTypes } from "@/findings/useProjectTypes";
import {
  Alert,
  Button,
  Dialog,
  Field,
  MenuButton,
  Segmented,
  Select,
  SeverityPill,
  TopicList,
  TopicPanel,
  useSeverityScale,
} from "@/ui";
import {
  findingItem,
  heightText,
  isFiltered,
  sideOptions,
  zoneLabel,
  zoneOptions,
  type Placed,
} from "./findingRows";
import type { FindingsLayer } from "./useFindingsLayer";
import type { ReviewActions } from "./useReviewActions";

const PLACED: { value: Placed; label: string }[] = [
  { value: "all", label: "All" },
  { value: "placed", label: "Placed" },
  { value: "unplaced", label: "Not placed" },
];

/** Spec §9 Findings: the list with zone, side and height; filters; Focus; Regroup. */
export function FindingsTopic({
  projectId,
  model,
  layer,
  actions,
}: {
  projectId: string;
  model: AssetModel;
  layer: FindingsLayer;
  actions: ReviewActions;
}) {
  const scale = useSeverityScale();
  const { defectTypes: types } = useProjectTypes(projectId);
  const review = model.review ?? null;
  const [confirm, setConfirm] = useState(false);
  const items = useMemo(() => {
    const name = (id: string) => types.find((t) => t.id === id)?.name;
    return layer.findings.map((f) => findingItem(f, name(f.type_id), scale, review));
  }, [layer.findings, types, scale, review]);
  const selected = layer.findings.find((f) => f.id === layer.selectedId) ?? null;
  const f = layer.filter;
  const set = (patch: Partial<typeof f>) => layer.setFilter({ ...f, ...patch });
  const busy = actions.running.place || actions.running.group;

  return (
    <TopicPanel
      title="Findings"
      count={layer.done ? layer.findings.length : null}
      menu={
        <MenuButton
          label="Findings actions"
          iconOnly
          size="sm"
          items={[
            {
              id: "compute",
              label: "Compute placements",
              icon: "pin",
              disabled: busy,
              onSelect: () => void actions.compute(false),
            },
            {
              id: "compute-dirty",
              label: "Compute changed placements",
              disabled: busy,
              onSelect: () => void actions.compute(true),
            },
            {
              id: "regroup",
              label: "Regroup findings",
              icon: "refresh",
              disabled: busy,
              onSelect: () => setConfirm(true),
            },
          ]}
        />
      }
      filters={
        <div className="grid grid-cols-2 gap-2">
          <Field label="Severity" htmlFor="af-severity">
            <Select
              id="af-severity"
              dense
              value={f.severity ?? ""}
              onChange={(e) => set({ severity: e.target.value || null })}
            >
              <option value="">Any</option>
              {scale.map((s) => (
                <option key={s.level} value={String(s.level)}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="af-type">
            <Select
              id="af-type"
              dense
              value={f.typeId ?? ""}
              onChange={(e) => set({ typeId: e.target.value || null })}
            >
              <option value="">Any</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zone" htmlFor="af-zone">
            <Select
              id="af-zone"
              dense
              value={f.zone ?? ""}
              onChange={(e) => set({ zone: e.target.value || null })}
            >
              <option value="">Any</option>
              {zoneOptions(review).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Side" htmlFor="af-side">
            <Select
              id="af-side"
              dense
              value={f.side ?? ""}
              onChange={(e) => set({ side: e.target.value || null })}
            >
              <option value="">Any</option>
              {sideOptions(review).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Segmented
            className="col-span-2"
            size="sm"
            label="Placed"
            options={PLACED}
            value={f.placed}
            onChange={(v) => set({ placed: v })}
          />
        </div>
      }
    >
      {layer.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" icon="refresh" onClick={layer.reload}>
              Retry
            </Button>
          }
        >
          {layer.error}
        </Alert>
      )}
      <TopicList
        label="Findings"
        items={items}
        selectedId={layer.selectedId}
        onSelect={layer.select}
        empty={
          layer.done ? (
            <p className="px-2 py-3 text-sm text-muted">
              {isFiltered(f) ? "No findings match these filters." : "No findings yet."}
            </p>
          ) : null
        }
      />
      {selected && (
        <section aria-label="Selected finding" className="flex flex-col gap-2 border-t border-line px-1 pt-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-ink">{formatFindingNumber(selected.number)}</span>
            <SeverityPill level={selected.severity} size="sm" />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted">Zone</dt>
            <dd className="text-ink">{zoneLabel(review, selected.zone) ?? "Not placed"}</dd>
            <dt className="text-muted">Side</dt>
            <dd className="text-ink">{selected.side ?? "Not placed"}</dd>
            <dt className="text-muted">Height</dt>
            <dd className="tabular-nums text-ink">{heightText(selected.height_m) ?? "Not placed"}</dd>
            <dt className="text-muted">Sightings</dt>
            <dd className="tabular-nums text-ink">{selected.sighting_count ?? 0}</dd>
          </dl>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              icon="crosshair"
              disabled={selected.placement !== "point" && selected.placement !== "patch"}
              onClick={() => layer.focus(selected.id)}
            >
              Focus
            </Button>
            <Link
              to={`/p/${projectId}/models/${model.id}/inspect?finding=${selected.id}`}
              className="inline-flex items-center rounded-control px-2 text-sm text-accent-ink hover:underline"
            >
              Inspect
            </Link>
            <Link
              to={findingPath(projectId, selected.id)}
              className="inline-flex items-center rounded-control px-2 text-sm text-accent-ink hover:underline"
            >
              Open in register
            </Link>
          </div>
        </section>
      )}
      <Dialog
        open={confirm}
        title="Regroup findings"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(false);
                void actions.regroup();
              }}
            >
              Regroup
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Sightings are grouped again by distance and group tags. Findings that survive keep their number,
          status, notes and comments. A finding merged into another is closed with a comment naming the one it
          joined; nothing is deleted.
        </p>
      </Dialog>
    </TopicPanel>
  );
}
