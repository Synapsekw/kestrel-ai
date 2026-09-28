import type { Box, ClassDef } from "@contract/client";
import { formatPercent } from "@/findings/format";
import { Button, InspectorPane, InspectorSection, TypeChip } from "@/ui";
import { useShapeActions } from "./seams";

/** §6.3: an accepted object is counted, not a finding (D7). */
export function ObjectCard({
  projectId,
  box,
  type,
}: {
  projectId: string;
  box: Box;
  type: ClassDef | undefined;
}) {
  const { remove } = useShapeActions(projectId);
  const by =
    box.provenance.kind === "person"
      ? "Drawn by hand"
      : `Model · ${box.provenance.model_name ?? "unknown model"}`;
  return (
    <InspectorPane
      label="Object"
      header={
        type ? (
          <TypeChip name={type.name} colour={type.colour} kind="object" />
        ) : (
          <span className="text-xs text-muted">Object</span>
        )
      }
      footer={
        <Button
          variant="danger"
          icon="trash"
          className="w-full justify-center"
          onClick={() => remove(box.id)}
        >
          Delete object
        </Button>
      }
    >
      <InspectorSection title="Confidence">
        <span className="font-mono text-sm text-ink">{formatPercent(box.confidence) ?? "—"}</span>
      </InspectorSection>
      <InspectorSection title="Provenance">
        <span className="text-xs text-muted">{by}</span>
      </InspectorSection>
    </InspectorPane>
  );
}
