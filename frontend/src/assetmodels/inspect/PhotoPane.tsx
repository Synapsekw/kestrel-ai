// The Photo mode: the existing ImageCanvas, loaded through the images store (useImageData), with the
// finding's polygons as its overlay. The annotations stay on (the overlay is drawn in their layer),
// and the pan tool is on, so a drag pans and nothing is edited by accident; both are restored after.
import { useEffect, useMemo } from "react";
import type { FindingSighting } from "@/api/assetReview";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { ImageCanvas } from "@/images/canvas/ImageCanvas";
import { useImageData } from "@/images/canvas/useImageData";
import { useImageUrl } from "@/images/workspace/seams";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { Alert, Skeleton, severityOf, useSeverityScale } from "@/ui";
import { InspectOverlay } from "./InspectOverlay";
import { overlayRings } from "./nav";

export function PhotoPane({
  projectId,
  imageId,
  sightings,
  opacity,
  comparing,
}: {
  projectId: string;
  imageId: string;
  sightings: readonly FindingSighting[];
  opacity: number;
  comparing: boolean;
}) {
  const { error } = useImageData(projectId, imageId);
  const { all: types } = useProjectTypes(projectId);
  const imageUrl = useImageUrl(projectId);
  const scale = useSeverityScale();
  const boxes = useImagesWorkspace((s) => s.boxes);
  const loadedId = useImagesWorkspace((s) => s.imageId);

  useEffect(() => {
    const s = useImagesWorkspace.getState();
    const before = { tool: s.tool, annotations: s.showAnnotations };
    s.setTool("pan");
    // The overlay lives in the canvas's interaction layer, which is hidden with the annotations.
    if (!s.showAnnotations) s.toggleAnnotations();
    return () => {
      const now = useImagesWorkspace.getState();
      now.setTool(before.tool);
      if (now.showAnnotations !== before.annotations) now.toggleAnnotations();
    };
  }, []);

  const rings = useMemo(
    () =>
      loadedId === imageId
        ? overlayRings(
            boxes,
            sightings,
            imageId,
            (sev) => severityOf(scale, sev)?.colour ?? scale[0]?.colour ?? "",
          )
        : [],
    [boxes, sightings, imageId, loadedId, scale],
  );
  const showing = !comparing && rings.length > 0;
  return (
    <div
      data-testid="inspect-photo"
      data-overlay={comparing ? "off" : "on"}
      data-rings={rings.length}
      className="relative h-full w-full"
    >
      {error ? (
        <div className="absolute inset-x-4 top-16 z-10">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : loadedId !== imageId ? (
        <div
          role="status"
          aria-label="Loading the photo"
          className="absolute inset-0 grid place-items-center"
        >
          <Skeleton className="h-40 w-56 rounded-panel" />
        </div>
      ) : null}
      <ImageCanvas
        projectId={projectId}
        types={types}
        imageUrl={imageUrl}
        overlay={showing ? <InspectOverlay rings={rings} opacity={opacity} /> : null}
      />
    </div>
  );
}
