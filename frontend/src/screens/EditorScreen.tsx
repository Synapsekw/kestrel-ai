import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { imageFileUrl, type Project } from "@contract/client";
import { useBackend } from "@/api/client";
import { useProject } from "@/api/project";
import { EditorCanvas } from "@/editor/EditorCanvas";
import { displayMaxSide } from "@/editor/geometry";
import { useEditorImage } from "@/editor/useEditorImage";
import { useEditorStore } from "@/store/editor";

export function EditorScreen() {
  const { projectId = "", imageId = "" } = useParams();
  const { project, error: projectError } = useProject(projectId);
  if (projectError) {
    return (
      <p role="alert" className="m-6 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
        {projectError}
      </p>
    );
  }
  if (!project) return <p className="m-6 text-sm text-slate-400">Loading project…</p>;
  return <EditorBody projectId={projectId} imageId={imageId} project={project} />;
}

function EditorBody({
  projectId,
  imageId,
  project,
}: {
  projectId: string;
  imageId: string;
  project: Project;
}) {
  const { baseUrl, token } = useBackend();
  const { loading } = useEditorImage(projectId, imageId, project.preannotation_model_id);
  const image = useEditorStore((s) => s.image);
  const error = useEditorStore((s) => s.error);
  const notice = useEditorStore((s) => s.notice);
  const activeClassId = useEditorStore((s) => s.activeClassId);
  const setActiveClass = useEditorStore((s) => s.setActiveClass);

  // A zustand action, not a React state setter: the compiler rule `set-state-in-effect` does not apply.
  useEffect(() => {
    if (!activeClassId || !project.classes.some((c) => c.id === activeClassId)) {
      setActiveClass(project.classes[0]?.id ?? null);
    }
  }, [activeClassId, project.classes, setActiveClass]);

  const src = useMemo(
    () => (image ? imageFileUrl(baseUrl, token, projectId, image.id, displayMaxSide(image)) : null),
    [baseUrl, token, projectId, image],
  );

  return (
    <div className="flex h-full min-h-0">
      <aside
        className="flex w-48 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-2"
        data-slot="classes"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-sm"
          data-slot="toolbar"
        >
          <span className="truncate text-slate-300">{image?.file_name ?? (loading ? "Loading…" : "")}</span>
        </div>
        {error && (
          <p role="alert" className="border-b border-red-900 bg-red-950 px-3 py-1 text-xs text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="border-b border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300"
          >
            {notice}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <EditorCanvas src={src} />
        </div>
      </div>
      <aside
        className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-950"
        data-slot="regions"
      />
    </div>
  );
}
