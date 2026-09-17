import { useParams } from "react-router-dom";

export function ReviewScreen() {
  const { projectId } = useParams();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Review</h1>
      <p className="mt-2 text-sm text-slate-400">Project {projectId}</p>
    </section>
  );
}
