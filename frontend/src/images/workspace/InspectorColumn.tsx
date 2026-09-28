import { type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { ImageDetail } from "@/api/images";
import { FindingInspector } from "@/findings/FindingInspector";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { Button, InspectorPane, SkeletonRows } from "@/ui";
import { FindingsOnImage } from "./FindingsOnImage";
import { ImagePanel } from "./ImagePanel";
import { MeasuredSize } from "./MeasuredSize";
import { ObjectCard } from "./ObjectCard";
import { useSelection } from "./seams";
import { SuggestionCard } from "./SuggestionCard";
import type { InspectorModel } from "./useInspectorModel";

export interface InspectorColumnProps {
  projectId: string;
  model: InspectorModel;
  detail: ImageDetail | null;
  onDetail: (d: ImageDetail) => void;
  distanceRef: RefObject<HTMLInputElement>;
  onShowOnImage: (boxId: string) => void;
}

/** §6.3: one of four panels, then Findings on this image. Keyed by state, so F's slide-in replays. */
export function InspectorColumn({
  projectId,
  model,
  detail,
  onDetail,
  distanceRef,
  onShowOnImage,
}: InspectorColumnProps) {
  const navigate = useNavigate();
  const { types } = useProjectTypes(projectId);
  const { select, boxes, selectedId } = useSelection();
  const s = model.state;

  function setDistance() {
    select(null);
    requestAnimationFrame(() => distanceRef.current?.focus());
  }

  let panel: ReactNode;
  if (s.kind === "finding") {
    const box = s.box;
    panel = (
      <FindingInspector
        key={`f-${s.findingId}`}
        projectId={projectId}
        findingId={s.findingId}
        measureSlot={
          box ? <MeasuredSize shape={box} camera={detail?.camera} onSetDistance={setDistance} /> : undefined
        }
        anchorSlot={
          box ? (
            <Button className="w-full justify-center" icon="images" onClick={() => onShowOnImage(box.id)}>
              Show on image
            </Button>
          ) : undefined
        }
        onNavigate={(href) => (href === null ? select(null) : void navigate(href))}
      />
    );
  } else if (s.kind === "pending-finding") {
    panel = (
      <InspectorPane
        key={`p-${s.box.id}`}
        label="Finding"
        header={<span className="text-xs text-muted">Creating the finding…</span>}
      >
        <SkeletonRows rows={4} columns={1} />
      </InspectorPane>
    );
  } else if (s.kind === "object") {
    panel = (
      <ObjectCard key={`o-${s.box.id}`} projectId={projectId} box={s.box} type={types.get(s.box.class_id)} />
    );
  } else if (s.kind === "suggestion") {
    panel = (
      <SuggestionCard
        key={`s-${s.box.id}`}
        projectId={projectId}
        box={s.box}
        type={types.get(s.box.class_id)}
      />
    );
  } else if (detail) {
    panel = (
      <ImagePanel
        key={`i-${detail.id}`}
        projectId={projectId}
        detail={detail}
        onDetail={onDetail}
        distanceRef={distanceRef}
      />
    );
  } else {
    panel = (
      <InspectorPane key="i-loading" label="Image" header={<span className="text-xs text-muted">Image</span>}>
        <SkeletonRows rows={5} columns={1} />
      </InspectorPane>
    );
  }

  return (
    <div
      role="region"
      aria-label="Image inspector"
      data-testid="inspector-column"
      className="flex min-h-0 flex-col gap-3"
    >
      <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
      <FindingsOnImage
        projectId={projectId}
        findings={model.findings}
        more={model.more}
        boxes={boxes}
        types={types}
        selectedId={selectedId}
        onSelect={(id) => {
          select(id);
          onShowOnImage(id);
        }}
      />
    </div>
  );
}
