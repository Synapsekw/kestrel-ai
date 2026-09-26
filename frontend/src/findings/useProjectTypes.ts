import { useMemo } from "react";
import type { ClassDef } from "@contract/client";
import { useProject } from "@/api/project";

export interface ProjectTypes {
  loaded: boolean;
  types: ReadonlyMap<string, ClassDef>;
  defectTypes: ClassDef[];
  all: ClassDef[];
}

/** The project's type list (`Project.classes`, derived from `project_type`, F §7.3). */
export function useProjectTypes(projectId: string): ProjectTypes {
  const { project } = useProject(projectId);
  return useMemo(() => {
    const all = [...(project?.classes ?? [])].sort((a, b) => a.order - b.order);
    return {
      loaded: project !== null,
      types: new Map(all.map((c) => [c.id, c])),
      defectTypes: all.filter((c) => c.kind === "defect"),
      all,
    };
  }, [project]);
}
