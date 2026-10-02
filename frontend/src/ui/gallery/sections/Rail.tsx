import { useMemo } from "react";
import { createRailStore, TopicList, TopicPanel, ToolButton, WorkspaceRail } from "@/ui";

export const title = "Workspace rail";
export const order = 51;

const FINDINGS = [
  { id: "1", label: "Crack, retaining wall", meta: "F-0031", swatch: "#ff5a4f" },
  { id: "2", label: "Pooling water", meta: "F-0032", swatch: "#ff9c3a" },
  { id: "3", label: "Rebar exposed", meta: "F-0033", swatch: "#e2bf2e" },
];

export default function RailSection() {
  const store = useMemo(
    () => createRailStore("maps", ["layers", "findings", "measure", "ai", "drawings"], "findings"),
    [],
  );
  return (
    <div className="relative h-[460px] overflow-hidden rounded-panel bg-bg">
      <WorkspaceRail
        label="Gallery rail"
        store={store}
        inspectorOpen={false}
        bottomInset={14}
        nav={<ToolButton icon="fit" label="Select" active onClick={() => {}} />}
        topics={[
          {
            id: "layers",
            label: "Layers",
            icon: "layers",
            group: "shared",
            body: (
              <TopicPanel title="Layers">
                <p className="text-sm text-muted">Base maps</p>
              </TopicPanel>
            ),
          },
          {
            id: "findings",
            label: "Findings",
            icon: "findings",
            group: "shared",
            body: (
              <TopicPanel
                title="Findings"
                count={3}
                visible={{ value: true, toggle: () => {} }}
                tools={[{ id: "pt", icon: "pin", label: "Finding point", shortcut: "M", onClick: () => {} }]}
              >
                <TopicList label="Findings" items={FINDINGS} selectedId="1" onSelect={() => {}} />
              </TopicPanel>
            ),
          },
          {
            id: "measure",
            label: "Measure",
            icon: "measure",
            group: "shared",
            body: (
              <TopicPanel title="Measure">
                <p />
              </TopicPanel>
            ),
          },
          {
            id: "ai",
            label: "AI",
            icon: "detect",
            group: "workspace",
            badge: 6,
            body: (
              <TopicPanel title="AI">
                <p />
              </TopicPanel>
            ),
          },
          {
            id: "drawings",
            label: "Drawings",
            icon: "drawing",
            group: "workspace",
            body: (
              <TopicPanel title="Drawings">
                <p />
              </TopicPanel>
            ),
          },
        ]}
      />
    </div>
  );
}
