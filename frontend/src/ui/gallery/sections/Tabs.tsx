import { useState } from "react";
import { Segmented } from "@/ui/Segmented";
import { Tabs } from "@/ui/Tabs";

export const title = "Tabs";
export const order = 80;

const PROJECT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "images", label: "Images", count: 1284 },
  { id: "maps", label: "Maps", count: 3 },
  { id: "clouds", label: "Point clouds", count: 2 },
  { id: "findings", label: "Findings", count: 47 },
  { id: "measurements", label: "Measurements" },
  { id: "reports", label: "Reports" },
];

export default function TabsSection() {
  const [tab, setTab] = useState("findings");
  const [status, setStatus] = useState<"open" | "reviewed" | "closed">("open");
  const [view, setView] = useState<"grid" | "map">("grid");
  return (
    <div className="grid gap-6">
      <Tabs label="Project" items={PROJECT_TABS} value={tab} onChange={setTab} />
      <div className="flex flex-wrap gap-4">
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: "Open", count: 47 },
            { value: "reviewed", label: "Reviewed", count: 112 },
            { value: "closed", label: "Closed", count: 309 },
          ]}
        />
        <Segmented
          label="View"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "grid", label: "Grid", icon: "grid" },
            { value: "map", label: "Map", icon: "map" },
          ]}
        />
      </div>
    </div>
  );
}
