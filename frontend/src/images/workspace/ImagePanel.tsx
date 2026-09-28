import { useId, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { setMarkedEmpty, setSubjectDistance, type ImageDetail } from "@/api/images";
import { useChangesStore } from "@/store/changes";
import { Button, Field, Input, InspectorPane, InspectorSection, Kbd, MenuButton, toast } from "@/ui";
import { cloudsContaining, openIn3dHref } from "./openIn3d";
import { SOURCE_LABEL } from "./measureText";
import { useProjectClouds } from "./useProjectClouds";

export interface ImagePanelProps {
  projectId: string;
  detail: ImageDetail;
  onDetail: (d: ImageDetail) => void;
  distanceRef: RefObject<HTMLInputElement>;
}

const FOOTPRINT: Record<string, string> = {
  trapezoid: "Ground footprint (flat-ground estimate)",
  wedge: "Wedge (oblique view, far edge clipped)",
  point: "Capture point only",
  none: "No location",
};
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const MAX_DISTANCE = 10_000;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </div>
  );
}

/** §6.3 "nothing selected": camera metadata, distance source, subject distance, footprint, N. */
export function ImagePanel({ projectId, detail, onDetail, distanceRef }: ImagePanelProps) {
  const api = useApi();
  const navigate = useNavigate();
  const fieldId = useId();
  const clouds = useProjectClouds(projectId);
  const cam = detail.camera;
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const covering = cloudsContaining(clouds, detail.lon, detail.lat);
  const items = covering.map((c) => ({
    id: `open-3d-${c.id}`,
    label: `Open in 3D · ${c.name}`,
    icon: "cloud" as const,
    onSelect: () => void navigate(openIn3dHref(projectId, c.id, detail.id, detail.width, detail.height)),
  }));

  async function save(value: number | null) {
    setSaving(true);
    try {
      onDetail(await setSubjectDistance(api, projectId, detail.id, value));
      setDraft("");
      useChangesStore.getState().bumpImages();
    } catch (e) {
      toast("danger", messageOf(e, "Could not save the distance. Try again."));
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    const v = Number(draft);
    if (!draft.trim() || !Number.isFinite(v) || v < 0.1 || v > MAX_DISTANCE) {
      setFieldError("Enter a distance between 0.1 and 10,000 m.");
      return;
    }
    setFieldError(null);
    void save(v);
  }

  async function toggleEmpty() {
    try {
      // `setMarkedEmpty` answers the contract's `Image` (no camera/footprint), not `ImageDetail`
      // (task-5 brief note): merge onto the current detail so the store keeps its camera fields.
      const result = await setMarkedEmpty(api, projectId, detail.id, !detail.marked_empty);
      onDetail({ ...detail, ...result });
      useChangesStore.getState().bumpImages();
    } catch (e) {
      toast("danger", messageOf(e, "Could not update the image. Try again."));
    }
  }

  const source = cam?.distance_source && cam.distance_source !== "none" ? cam.distance_source : null;
  const distanceText =
    cam?.distance_m != null && source
      ? `${cam.distance_m.toFixed(1)} m · ${SOURCE_LABEL[source]} · ±${(cam.distance_sigma_m ?? 0).toFixed(1)} m`
      : "No trustworthy distance · px only";

  return (
    <InspectorPane
      label="Image"
      header={
        <>
          <div className="flex min-w-0 flex-col">
            <span className="text-xs text-muted">Image</span>
            <span className="truncate font-mono text-xs font-semibold text-ink">{detail.file_name}</span>
          </div>
          {items.length > 0 && (
            <MenuButton label="Image actions" iconOnly icon="list" size="sm" variant="ghost" items={items} />
          )}
        </>
      }
      footer={
        <Button className="w-full justify-center" onClick={() => void toggleEmpty()}>
          {detail.marked_empty ? "Marked: nothing to report · Undo" : "Nothing to report"} <Kbd>N</Kbd>
        </Button>
      }
    >
      <InspectorSection title="Camera">
        <div className="flex flex-col gap-1">
          <Row
            label="Captured"
            value={detail.capture_time ? dateTime.format(new Date(detail.capture_time)) : "—"}
          />
          <Row
            label="Location"
            value={
              detail.lat != null && detail.lon != null
                ? `${detail.lat.toFixed(5)}, ${detail.lon.toFixed(5)}`
                : "No GPS"
            }
          />
          <Row label="Altitude" value={cam?.rel_alt != null ? `${cam.rel_alt.toFixed(1)} m AGL` : "—"} />
          <Row
            label="Gimbal"
            value={
              cam?.gimbal_pitch != null
                ? `pitch ${cam.gimbal_pitch.toFixed(1)}° · yaw ${(cam.gimbal_yaw ?? 0).toFixed(1)}°`
                : "—"
            }
          />
          <Row label="Camera" value={cam?.camera_model ?? "—"} />
        </div>
      </InspectorSection>
      <InspectorSection title="Distance and GSD">
        <div className="flex flex-col gap-1">
          <Row label="GSD" value={cam?.gsd_mm != null ? `${cam.gsd_mm.toFixed(1)} mm/px` : "—"} />
          <p className="text-xs text-muted">{distanceText}</p>
        </div>
      </InspectorSection>
      <InspectorSection title="Subject distance">
        <Field
          label="Subject distance (m)"
          htmlFor={fieldId}
          error={fieldError}
          hint={
            cam?.subject_distance_m != null
              ? `Set by hand: ${cam.subject_distance_m} m`
              : "Overrides the automatic distance."
          }
        >
          <div className="flex gap-2">
            <Input
              id={fieldId}
              ref={distanceRef}
              inputMode="decimal"
              value={draft}
              placeholder={cam?.subject_distance_m != null ? String(cam.subject_distance_m) : "auto"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            {cam?.subject_distance_m != null && (
              <Button size="sm" variant="ghost" loading={saving} onClick={() => void save(null)}>
                Clear
              </Button>
            )}
          </div>
        </Field>
      </InspectorSection>
      <InspectorSection title="Footprint">
        <p className="text-xs text-muted">{FOOTPRINT[detail.footprint_kind ?? "none"] ?? FOOTPRINT.none}</p>
      </InspectorSection>
    </InspectorPane>
  );
}
