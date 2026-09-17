import { useParams } from "react-router-dom";

export function QueryScreen() {
  const { projectId } = useParams();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Query</h1>
      <p className="mt-2 text-sm text-slate-400">Project {projectId}</p>
    </section>
  );
}
