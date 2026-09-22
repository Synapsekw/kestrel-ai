import { useState } from "react";
import { SetupAgent } from "./SetupAgent";
import { ProjectAgent } from "./project/ProjectAgent";

/**
 * One drawer, two modes: the Project agent inside a project, the Setup agent elsewhere. The mode is
 * chosen when the drawer opens: the Setup agent moves into the project it just created and continues
 * there, so it stays until the drawer closes. The Setup agent stays mounted so its draft and jobs
 * survive the visit.
 */
export function AgentDrawer({
  projectId,
  projectName = null,
  open,
  onClose,
}: {
  projectId: string | undefined;
  projectName?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [setupLatched, setSetupLatched] = useState(open && !projectId);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setSetupLatched(open && !projectId);
  }
  const setup = !projectId || setupLatched;
  return (
    <>
      <SetupAgent open={open && setup} onClose={onClose} />
      {projectId && (
        <ProjectAgent
          key={projectId}
          projectId={projectId}
          projectName={projectName}
          open={open && !setup}
          onClose={onClose}
        />
      )}
    </>
  );
}
