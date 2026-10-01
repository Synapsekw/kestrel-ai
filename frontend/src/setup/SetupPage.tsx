import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { LIBRARY_JOBS } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { Button, toast } from "@/ui";
import type { ProjectTemplate } from "./api";
import { AnomaliesCard } from "./AnomaliesCard";
import { BasicsCard } from "./BasicsCard";
import { createFromDraft } from "./createProject";
import { DataCard } from "./DataCard";
import { useSetupDraft, type SetupDraft } from "./draftStore";
import { SummaryCard } from "./SummaryCard";
import { TemplateCard } from "./TemplateCard";
import { useTemplateChoice } from "./templateChoice";
import { useTemplates } from "./useTemplates";
import { useWide } from "./useWide";

/** Spec §8, layout A: Template, Basics, Data, Anomalies, and a summary that stays in view. */
export function SetupPage() {
  const api = useApi();
  const navigate = useNavigate();
  const list = useTemplates();
  const { reload } = list;
  const choice = useTemplateChoice();
  const wide = useWide();

  // S-R5 placeholder: ensure + create + open. U6 replaces this handler with runSetup, which starts the imports.
  const onCreate = useCallback(
    async (draft: SetupDraft) => {
      const project = await createFromDraft(api, draft);
      const sorted = draft.buckets.some((b) => b.slot_key !== null && !b.skipped);
      useSetupDraft.getState().discard();
      pushLog(`created project ${project.id} from the setup page`);
      if (sorted) toast("info", "Project created. Add the sorted data with Add data on the project's tabs.");
      void navigate(`/p/${project.id}/overview`);
    },
    [api, navigate],
  );

  const onTemplateSaved = useCallback(
    (t: ProjectTemplate) => {
      reload();
      useSetupDraft.getState().chooseTemplate(t, "replace");
    },
    [reload],
  );

  const discard = () => {
    // A sort still running would finish into an empty draft and toast; stop it, without waiting for the answer.
    const run = useSetupDraft.getState().inspect;
    if (run) {
      cancelJob(api, LIBRARY_JOBS, run.jobId).catch((e: unknown) =>
        pushLog(`cancel sort ${run.jobId} on discard failed: ${messageOf(e, String(e))}`),
      );
    }
    useSetupDraft.getState().discard();
    void navigate("/projects");
  };

  const summary = (variant: "card" | "bar") => (
    <SummaryCard
      templates={list.items}
      catalogueAvailable={list.unavailable === null}
      variant={variant}
      onCreate={onCreate}
      onTemplateSaved={onTemplateSaved}
    />
  );

  return (
    <section aria-label="New project" className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">New project</h1>
          <p className="max-w-prose text-sm text-muted">
            Choose what you are inspecting, drop the delivery folder and decide which anomalies to look for.
            The draft stays here until you create the project or discard it.
          </p>
        </div>
        <Button variant="ghost" icon="trash" onClick={discard}>
          Discard draft
        </Button>
      </header>
      <div
        className={wide ? "grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4" : "flex flex-col gap-4"}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <TemplateCard list={list} choice={choice} />
          <BasicsCard />
          <DataCard templates={list.items} onUseTemplate={choice.request} />
          <AnomaliesCard />
        </div>
        {wide && summary("card")}
      </div>
      {!wide && summary("bar")}
    </section>
  );
}
