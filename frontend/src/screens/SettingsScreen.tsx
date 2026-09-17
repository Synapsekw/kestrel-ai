import { useParams } from "react-router-dom";

export function SettingsScreen() {
  const { projectId } = useParams();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-slate-400">Project {projectId}</p>
    </section>
  );
}
