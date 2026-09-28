/* eslint-disable react-refresh/only-export-components --
   OFFSET_SAVE_MS and parseOffsetInput are exported next to the component that uses them (the
   brief's interface and the "-" parse-path test need them); not a fast-refresh boundary. */
import { useRef, useState } from "react";
import type { CloudCameraSource } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { setCloudCameraOffset } from "@/api/cloudCameras";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { IconButton, Input, Pill, Switch, toast } from "@/ui";
import {
  clampOffset,
  disabledReason,
  heightsLookOff,
  OFFSET_MAX_M,
  OFFSET_MIN_M,
  photoCount,
  posedCount,
} from "./cameraMath";
import { camerasShown, useCamerasStore } from "./store";

/** An offset is saved this long after the last nudge or keystroke (one PUT per burst). */
export const OFFSET_SAVE_MS = 400;

/**
 * `text` as a finished number, or `null` while it is still intermediate ("", "-", a trailing ".",
 * or anything else `Number` cannot parse) — the guard that keeps a half-typed offset from being
 * saved or reformatted under the cursor. Exported so the "-" case (jsdom sanitises an invalid
 * `type="number"` value to "" before `onChange` ever sees it, so a `fireEvent` cannot exercise this
 * branch through the DOM) is provable against the real string.
 */
export function parseOffsetInput(text: string): number | null {
  const t = text.trim();
  if (t === "" || t === "-" || t.endsWith(".")) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function OffsetRow({
  projectId,
  cloudId,
  source,
  index,
}: {
  projectId: string;
  cloudId: string;
  source: CloudCameraSource;
  index: number;
}) {
  const api = useApi();
  const [draft, setDraft] = useState(String(source.height_offset_m));
  const value = useRef(source.height_offset_m);
  const timer = useRef<number | undefined>(undefined);

  const apply = (raw: number, reformat: boolean) => {
    const v = clampOffset(raw);
    value.current = v;
    if (reformat) setDraft(String(v));
    useCamerasStore.getState().applyLocalOffset(index, v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // Success needs no refetch here: the PUT publishes pointclouds.changed (Ruling 4).
      setCloudCameraOffset(api, projectId, cloudId, source.id, v).catch((e: unknown) => {
        toast("danger", messageOf(e, "could not save the height offset"));
        useCamerasStore.getState().reload();
      });
    }, OFFSET_SAVE_MS);
  };

  return (
    <div
      role="group"
      aria-label={`Height offset, ${source.label}`}
      className="flex items-center gap-1.5 text-xs"
    >
      <span className="min-w-0 flex-1 truncate text-ink" title={source.label}>
        {source.label}
      </span>
      <IconButton
        icon="minus"
        size="sm"
        label={`Lower ${source.label} by 1 m`}
        onClick={() => apply(value.current - 1, true)}
      />
      <Input
        type="number"
        inputMode="decimal"
        step={0.1}
        min={OFFSET_MIN_M}
        max={OFFSET_MAX_M}
        dense
        value={draft}
        aria-label={`Height offset for ${source.label} in metres`}
        className="w-20 text-right font-mono"
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const n = parseOffsetInput(text);
          if (n !== null) apply(n, false);
        }}
        onBlur={() => setDraft(String(value.current))}
      />
      <span className="text-muted">m</span>
      <IconButton
        icon="plus"
        size="sm"
        label={`Raise ${source.label} by 1 m`}
        onClick={() => apply(value.current + 1, true)}
      />
    </div>
  );
}

/**
 * Section (7) of the cloud panel (spec §6, §10.2, §14): "Show camera positions" with the photo
 * counts, the reason when it cannot be switched on, the implausible-height warning, and one height
 * offset editor per image set.
 */
export function CamerasPanelRow({ projectId, cloud }: { projectId: string; cloud: PointCloud }) {
  const status = useCamerasStore((s) => s.status);
  const set = useCamerasStore((s) => s.set);
  const error = useCamerasStore((s) => s.error);
  const visible = useCamerasStore((s) => s.visible);
  const reason = disabledReason(status, set, error);
  const shown = camerasShown({ visible, set });

  return (
    <section aria-label="Camera positions" className="flex flex-col gap-1.5" data-testid="cameras-row">
      <Switch
        checked={shown}
        disabled={reason !== null}
        onChange={(v) => useCamerasStore.getState().setVisible(v)}
        label="Show camera positions"
      />
      {reason !== null || !set ? (
        <p className="text-xs text-muted" data-testid="cameras-reason">
          {reason}
        </p>
      ) : (
        <p className="text-xs text-muted">
          {photoCount(set.image_id.length)} · {posedCount(set).toLocaleString("en-GB")} with angles
        </p>
      )}
      {set && set.without_gps > 0 && (
        <p className="text-xs text-muted">{photoCount(set.without_gps)} without GPS</p>
      )}
      {set?.truncated && <p className="text-xs text-muted">The first 20,000 photos are shown</p>}
      {set && set.image_id.length > 0 && heightsLookOff(set, cloud.z_stats?.p50) && (
        <Pill tone="warn" size="sm" className="self-start">
          Camera heights look off; set a height offset
        </Pill>
      )}
      {shown &&
        set?.sources.map((s, k) => (
          <OffsetRow key={s.id} projectId={projectId} cloudId={cloud.id} source={s} index={k} />
        ))}
    </section>
  );
}
