import { useParams } from "react-router-dom";
import { useProject } from "@/api/project";
import { ClassesSection } from "@/settings/ClassesSection";
import { ImportDefaultsSection } from "@/settings/ImportDefaultsSection";
import { PreannotationSection } from "@/settings/PreannotationSection";
import { ProvidersSection } from "@/settings/ProvidersSection";
import { SourcesSection } from "@/settings/SourcesSection";
import { Alert, Skeleton } from "@/ui";

export function SettingsScreen() {
  const { projectId = "" } = useParams();
  const { project, error, setProject } = useProject(projectId);
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Project settings</h1>
        <p className="text-sm text-muted">
          Classes, pre-annotation, import defaults and the imported folders of this project.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!project && !error && (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {project && (
        <div className="divide-y divide-line">
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
        </div>
      )}
    </section>
  );
}
