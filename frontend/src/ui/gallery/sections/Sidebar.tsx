import { useState } from "react";
import { SidebarProjectTree } from "@/app/SidebarProjectTree";
import { SidebarView } from "@/app/SidebarView";

export const title = "Sidebar";
export const order = 55;

const COUNTS = { images: 1284, maps: 3, drawings: 1, pointClouds: 2, openFindings: 47 };

function Frame({ collapsed, inProject }: { collapsed: boolean; inProject: boolean }) {
  const [c, setC] = useState(collapsed);
  return (
    <div className="flex h-[640px] overflow-hidden rounded-panel border border-line bg-bg">
      <SidebarView
        section="projects"
        projectId={inProject ? "demo" : undefined}
        collapsed={c}
        activeJobs={2}
        onToggle={() => setC((v) => !v)}
        tree={
          inProject ? (
            <SidebarProjectTree
              projectId="demo"
              projectName="Al Khail Gate Phase 2"
              busy
              counts={COUNTS}
              tab="findings"
              secondary={null}
              collapsed={c}
            />
          ) : undefined
        }
      />
      <div className="flex-1" />
    </div>
  );
}

export default function SidebarSection() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Frame collapsed={false} inProject />
      <Frame collapsed inProject />
      <Frame collapsed={false} inProject={false} />
    </div>
  );
}
