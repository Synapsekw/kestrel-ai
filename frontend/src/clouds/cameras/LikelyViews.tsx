/* eslint-disable react-refresh/only-export-components --
   LIKELY_VIEWS_DEFAULT and absoluteImagePath are exported next to the component that uses them
   (C-P1's default and the attach-path test need them); not a fast-refresh boundary. */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { thumbnailUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { addAttachment } from "@/api/findings";
import { fetchImage } from "@/api/images";
import { fetchProject } from "@/api/project";
import { imageJumpHref } from "@/clouds/jump";
import { photosSeeing } from "@/clouds/photoLink";
import { ownFindingsWrite } from "@/store/changesOwnWrite";
import type { WorkspaceSeams } from "@/clouds/workspace/seams";
import { Button, Pill, toast } from "@/ui";
import { disabledReason, methodLabel, photoCount, spotOf } from "./cameraMath";
import { useCamerasStore } from "./store";

export const LIKELY_VIEWS_DEFAULT = 6;

export interface LikelyViewsProps {
  point: [number, number, number];
  normal: [number, number, number] | null;
  /** When given, each thumbnail offers Attach (F's attachment POST with the image's absolute path). */
  findingId?: string;
  /** Thumbnails shown (default 6); the count line always states the full total. */
  limit?: number;
}

/** F copies an attachment from a local path (spec §4.1): the project folder plus `image.path`. */
export function absoluteImagePath(folder: string, relPath: string): string {
  return `${folder.replace(/\\/g, "/").replace(/\/+$/, "")}/${relPath.replace(/^\/+/, "")}`;
}

/**
 * "Likely views" for a 3D point (spec §9.3, §9.4, §10.3): the photo-link hits for the point, best
 * first, as thumbnails that open the image at the spot, with Attach when a finding is given. It is
 * the `LikelyViews` workspace seam (controller ruling 1); C-P1 renders it in the anchor slot and the
 * callout.
 */
export function LikelyViews({ point, normal, findingId, limit = LIKELY_VIEWS_DEFAULT }: LikelyViewsProps) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const status = useCamerasStore((s) => s.status);
  const set = useCamerasStore((s) => s.set);
  const error = useCamerasStore((s) => s.error);
  const cloudId = useCamerasStore((s) => s.cloudId);
  const [busy, setBusy] = useState<string | null>(null);
  const [px, py, pz] = point;
  const [nx, ny, nz] = normal ?? [0, 0, 0];
  const hasNormal = normal !== null;

  const result = useMemo(
    () => (set ? photosSeeing({ x: px, y: py, z: pz }, hasNormal ? [nx, ny, nz] : null, set) : null),
    [set, px, py, pz, nx, ny, nz, hasNormal],
  );

  const reason = disabledReason(status, set, error);
  if (reason !== null || !result || !cloudId) {
    return <p className="text-xs text-muted">{reason ?? "Loading the drone photos…"}</p>;
  }
  if (result.total === 0) return <p className="text-xs text-muted">No photo saw this point</p>;

  const attach = async (imageId: string) => {
    if (!findingId) return;
    setBusy(imageId);
    try {
      const [img, project] = await Promise.all([
        fetchImage(api, projectId, imageId),
        fetchProject(api, projectId),
      ]);
      const path = absoluteImagePath(project.folder, img.path);
      await ownFindingsWrite([findingId], () => addAttachment(api, projectId, findingId, path));
      toast("ok", `Attached ${img.file_name}`);
    } catch (e) {
      toast("danger", messageOf(e, "could not attach the photo"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="likely-views">
      <p className="text-xs text-muted">Likely views · seen in {photoCount(result.total)}</p>
      <ul className="grid grid-cols-2 gap-2">
        {result.hits.slice(0, limit).map((h, k) => (
          <li key={h.index} className="flex flex-col gap-1">
            <button
              type="button"
              aria-label={`Open photo ${k + 1}, ${methodLabel(h.method)}, ${h.distanceM.toFixed(1)} m`}
              className="overflow-hidden rounded-control"
              onClick={() => navigate(imageJumpHref(projectId, h.imageId, cloudId, spotOf(h)))}
            >
              <img
                src={thumbnailUrl(baseUrl, token, projectId, h.imageId)}
                loading="lazy"
                alt=""
                className="aspect-[4/3] w-full bg-surface-2 object-cover"
              />
            </button>
            <div className="flex items-center gap-1 text-2xs text-muted">
              <Pill size="sm" tone={h.method === "frustum" ? "accent" : "neutral"}>
                {methodLabel(h.method)}
              </Pill>
              <span>{h.distanceM.toFixed(1)} m</span>
            </div>
            {findingId && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Attach photo ${k + 1}`}
                loading={busy === h.imageId}
                disabled={busy !== null}
                onClick={() => void attach(h.imageId)}
              >
                Attach
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Enforces the `LikelyViews` workspace seam type (`WorkspaceSeams["LikelyViews"]`) at compile time,
// replacing the tautological runtime "fits the seam type" test (controller adaptation).
LikelyViews satisfies NonNullable<WorkspaceSeams["LikelyViews"]>;
