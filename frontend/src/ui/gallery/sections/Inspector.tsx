import { useState } from "react";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { InspectorLayout, InspectorPane, InspectorSection } from "@/ui/Inspector";
import { Textarea } from "@/ui/Input";
import { Segmented } from "@/ui/Segmented";
import { SeverityPicker } from "@/ui/Severity";
import { TypeChip } from "@/ui/TypeChip";

export const title = "Inspector";
export const order = 130;

export default function InspectorSectionDemo() {
  const [open, setOpen] = useState(true);
  const [severity, setSeverity] = useState<number | null>(3);
  const [status, setStatus] = useState<"open" | "reviewed" | "closed">("reviewed");
  return (
    <div className="grid h-[640px] gap-3">
      <Button className="w-fit" onClick={() => setOpen((o) => !o)}>
        {open ? "Close the inspector" : "Open the inspector"}
      </Button>
      <InspectorLayout
        inspector={
          open ? (
            <InspectorPane
              label="Finding F-0217"
              header={
                <>
                  <span className="font-mono text-xs text-muted">F-0217</span>
                  <span className="rounded-chip bg-grad-ai px-2 py-0.5 text-2xs">model: cracks-v3</span>
                </>
              }
              footer={
                <Button variant="primary" className="w-full">
                  Close finding
                </Button>
              }
            >
              <InspectorSection title="Type">
                <TypeChip name="Crack" colour="#ff5a4f" kind="defect" />
              </InspectorSection>
              <InspectorSection title="Severity">
                <SeverityPicker value={severity} onChange={setSeverity} />
              </InspectorSection>
              <InspectorSection title="Status">
                <Segmented
                  label="Status"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "reviewed", label: "Reviewed" },
                    { value: "closed", label: "Closed" },
                  ]}
                />
              </InspectorSection>
              <InspectorSection title="AI provenance">
                <div className="flex items-center gap-2.5 rounded-control border border-accent/30 bg-grad-ai px-3 py-2.5 text-xs">
                  <Icon name="sparkle" size={16} className="text-accent-ink" />
                  cracks-v3 · confidence 0.91
                </div>
              </InspectorSection>
              <InspectorSection title="Note">
                <Textarea rows={3} defaultValue="Hairline crack along the pour joint, about 40 cm." />
              </InspectorSection>
            </InspectorPane>
          ) : null
        }
      >
        <div className="grid h-full place-items-center rounded-panel border border-card-line bg-surface text-sm text-muted">
          the Findings table
        </div>
      </InspectorLayout>
    </div>
  );
}
