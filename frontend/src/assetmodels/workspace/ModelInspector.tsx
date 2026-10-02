import type { ReactNode } from "react";
import { GlassPanel, Tabs, stagger } from "@/ui";

export type ModelInspectorTab = "parts" | "part" | "versions" | "run";

const LABEL: Record<ModelInspectorTab, string> = {
  parts: "Parts",
  part: "Part",
  versions: "Versions",
  run: "Run",
};

/**
 * The inspector (right 14, top 14, bottom 84, width 330): Parts n · Part · Versions n, and the Run
 * tab when U7 passes `runTab`. Only the active tab's body is mounted; it scrolls inside the panel.
 */
export function ModelInspector({
  tab,
  onTab,
  partsTab,
  partTab,
  versionsTab,
  runTab,
  partsCount,
  versionsCount,
}: {
  tab: ModelInspectorTab;
  onTab(tab: ModelInspectorTab): void;
  partsTab: ReactNode;
  partTab: ReactNode;
  versionsTab: ReactNode;
  runTab?: ReactNode;
  partsCount?: number | null;
  versionsCount?: number | null;
}) {
  const shown: ModelInspectorTab = tab === "run" && runTab === undefined ? "parts" : tab;
  const body = { parts: partsTab, part: partTab, versions: versionsTab, run: runTab }[shown];
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      as="aside"
      aria-label="Inspector"
      data-testid="model-inspector"
      style={stagger(2)}
      className="stagger absolute bottom-[84px] right-3.5 top-3.5 z-10 flex w-[330px] flex-col overflow-hidden animate-slide-in reduce-motion:animate-none"
    >
      <div className="border-b border-line px-2 pt-2">
        <Tabs
          label="Inspector"
          value={shown}
          onChange={(id) => onTab(id as ModelInspectorTab)}
          items={[
            { id: "parts", label: "Parts", count: partsCount ?? null },
            { id: "part", label: "Part" },
            { id: "versions", label: "Versions", count: versionsCount ?? null },
            ...(runTab !== undefined ? [{ id: "run", label: "Run" }] : []),
          ]}
        />
      </div>
      <div role="tabpanel" aria-label={LABEL[shown]} className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {body}
      </div>
    </GlassPanel>
  );
}
