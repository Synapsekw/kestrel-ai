import { useParams } from "react-router-dom";

export function EditorScreen() {
  const { projectId } = useParams();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Editor</h1>
      <p className="mt-2 text-sm text-slate-400">Project {projectId}</p>
    </section>
  );
}
