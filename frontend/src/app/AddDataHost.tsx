import { useEffect } from "react";
import type { Project } from "@contract/client";
import { AddDataDialog } from "@/data/AddDataDialog";
import { useAddData } from "./addDataStore";

/**
 * Mounted once by Shell with its loaded project (null while it loads or cannot load). It publishes
 * that project to the store, which gates every Add data entry point, and renders S1's Add data
 * dialog (spec 2026-09-26-foundation section 6.4).
 */
export function AddDataHost({ project }: { project: Project | null }) {
  const open = useAddData((s) => s.open);
  const tile = useAddData((s) => s.tile);
  const close = useAddData((s) => s.close);
  const setProject = useAddData((s) => s.setProject);
  const projectId = project?.id ?? null;
  useEffect(() => setProject(projectId), [projectId, setProject]);
  if (!open || !project) return null;
  return <AddDataDialog key={tile ?? "tiles"} project={project} initialTile={tile} onClose={close} />;
}
