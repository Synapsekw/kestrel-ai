import type { Box, ClassDef } from "@contract/client";
import { formatPercent } from "@/findings/format";
import { Button, InspectorPane, InspectorSection, Kbd, Pill, Progress, TypeChip } from "@/ui";
import { useSuggestionActions } from "./seams";

/** §6.3: the focused suggestion: type (T to change), confidence, model, Accept / Reject (FA's command). */
export function SuggestionCard({
  projectId,
  box,
  type,
}: {
  projectId: string;
  box: Box;
  type: ClassDef | undefined;
}) {
  const { accept, reject } = useSuggestionActions(projectId);
  return (
    <InspectorPane
      label="Suggestion"
      header={
        <Pill size="sm" tone="accent">
          AI suggestion
        </Pill>
      }
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => accept(box.id)}>
            Accept <Kbd>A</Kbd>
          </Button>
          <Button onClick={() => reject(box.id)}>
            Reject <Kbd>X</Kbd>
          </Button>
        </div>
      }
    >
      <InspectorSection title="Type" action={<span className="text-xs text-muted">T to change</span>}>
        {type ? (
          <TypeChip
            name={type.name}
            colour={type.colour}
            kind={type.kind === "defect" ? "defect" : "object"}
          />
        ) : (
          <span className="text-xs text-muted">Unknown type</span>
        )}
      </InspectorSection>
      <InspectorSection title="Confidence">
        <div className="flex items-center gap-2">
          <Progress value={box.confidence ?? 0} label="Confidence" thin className="flex-1" />
          <span className="font-mono text-xs text-ink">{formatPercent(box.confidence) ?? "—"}</span>
        </div>
      </InspectorSection>
      <InspectorSection title="Model">
        <span className="text-xs text-muted">{box.provenance.model_name ?? "unknown model"}</span>
      </InspectorSection>
    </InspectorPane>
  );
}
