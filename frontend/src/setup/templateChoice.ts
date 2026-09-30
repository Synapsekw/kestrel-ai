import { useCallback, useState } from "react";
import type { ProjectTemplate } from "./api";
import { useSetupDraft } from "./draftStore";

export interface TemplateChoice {
  /** The template waiting for replace-or-keep; `undefined` when no question is open, `null` for Blank. */
  pending: ProjectTemplate | null | undefined;
  request: (t: ProjectTemplate | null) => void;
  resolve: (mode: "replace" | "keep") => void;
  cancel: () => void;
}

/** Spec §8: a switch applies at once, unless the anomaly list was edited; then the operator chooses. */
export function useTemplateChoice(): TemplateChoice {
  const [pending, setPending] = useState<ProjectTemplate | null | undefined>(undefined);

  const request = useCallback((t: ProjectTemplate | null) => {
    const draft = useSetupDraft.getState();
    if ((t?.id ?? null) === draft.templateId) {
      setPending(undefined);
      return;
    }
    if (draft.typesEdited) {
      setPending(t);
      return;
    }
    draft.chooseTemplate(t, "replace");
    setPending(undefined);
  }, []);

  const resolve = useCallback(
    (mode: "replace" | "keep") => {
      if (pending === undefined) return;
      useSetupDraft.getState().chooseTemplate(pending, mode);
      setPending(undefined);
    },
    [pending],
  );

  const cancel = useCallback(() => setPending(undefined), []);
  return { pending, request, resolve, cancel };
}
