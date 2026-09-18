import { useParams } from "react-router-dom";
import { useProject } from "@/api/project";
import { ClassesSection } from "@/settings/ClassesSection";
import { ImportDefaultsSection } from "@/settings/ImportDefaultsSection";
import { PreannotationSection } from "@/settings/PreannotationSection";
import { ProvidersSection } from "@/settings/ProvidersSection";
import { SourcesSection } from "@/settings/SourcesSection";

export function SettingsScreen() {
  const { projectId = "" } = useParams();
  const { project, error, setProject } = useProject(projectId);
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {!project && !error && <p className="text-sm text-slate-400">Loading project…</p>}
      {project && (
        <>
          {/* keys remount the form sections with fresh drafts whenever the saved project changes */}
          <ClassesSection key={JSON.stringify(project.classes)} project={project} onSaved={setProject} />
          <PreannotationSection project={project} onSaved={setProject} />
          <ImportDefaultsSection
            key={JSON.stringify(project.import_defaults)}
            project={project}
            onSaved={setProject}
          />
          <SourcesSection projectId={projectId} />
          <ProvidersSection />
        </>
      )}
    </section>
  );
}
