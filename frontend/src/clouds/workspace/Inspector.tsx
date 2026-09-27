import { EmptyState, GlassPanel, MenuButton, Tabs, stagger, type MenuItem } from "@/ui";
import type { InspectorTab, TabContent } from "./types";

/**
 * The inspector (spec §6: right 14, top 14, bottom 204, width 330): Findings n | Measurements n,
 * the bodies C-P1 and C-M1 provide, and the Findings tab's menu (C-R1's "Capture missing views").
 */
export function Inspector({
  tab,
  onTab,
  findings,
  measurements,
  findingsMenu,
}: {
  tab: InspectorTab;
  onTab(tab: InspectorTab): void;
  findings: TabContent | null;
  measurements: TabContent | null;
  findingsMenu: readonly MenuItem[];
}) {
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      as="aside"
      aria-label="Inspector"
      data-testid="cloud-inspector"
      style={stagger(2)}
      className="stagger absolute bottom-[204px] right-3.5 top-3.5 z-10 flex w-[330px] flex-col overflow-hidden animate-slide-in reduce-motion:animate-none"
    >
      <div className="flex items-end gap-1 border-b border-line px-2 pt-2">
        <Tabs
          label="Inspector"
          className="min-w-0 flex-1"
          value={tab}
          onChange={(id) => onTab(id as InspectorTab)}
          items={[
            { id: "findings", label: "Findings", count: findings?.count ?? null },
            { id: "measurements", label: "Measurements", count: measurements?.count ?? null },
          ]}
        />
        {tab === "findings" && findingsMenu.length > 0 && (
          <MenuButton label="Findings actions" iconOnly size="sm" items={findingsMenu} />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {tab === "findings"
          ? (findings?.body ?? (
              <EmptyState icon="pin" title="Findings on this cloud">
                Pinned findings are listed here.
              </EmptyState>
            ))
          : (measurements?.body ?? (
              <EmptyState icon="measure" title="Measurements on this cloud">
                Saved measurements are listed here.
              </EmptyState>
            ))}
      </div>
    </GlassPanel>
  );
}
