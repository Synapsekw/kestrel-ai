import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import {
  deleteFinding,
  fetchFinding,
  patchFinding,
  type FindingDetail,
  type FindingPatch,
} from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";

interface Loaded {
  id: string;
  finding: FindingDetail | null;
  error: string | null;
}

function updateFailure(e: unknown): string {
  switch (codeOf(e)) {
    case "invalid_transition":
      return "A closed finding has to be reopened before it can be marked reviewed.";
    case "not_a_defect":
      return "Only defect types can hold a finding.";
    default:
      return messageOf(e, "could not save the finding");
  }
}

/** One finding's detail, re-read on `findings.changed`; writes are optimistic and revert on refusal. */
export function useFinding(projectId: string, findingId: string) {
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFinding(api, projectId, findingId)
      .then((finding) => {
        if (!cancelled) setLoaded({ id: findingId, finding, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoaded({ id: findingId, finding: null, error: messageOf(e, "could not load the finding") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId, revision]);

  const current = loaded && loaded.id === findingId ? loaded : null;
  const before = current?.finding ?? null;

  const update = useCallback(
    async (patch: FindingPatch) => {
      if (!before) return;
      setLoaded({ id: findingId, finding: { ...before, ...patch } as FindingDetail, error: null });
      try {
        const saved = await patchFinding(api, projectId, findingId, patch);
        setLoaded({ id: findingId, finding: saved, error: null });
        useChangesStore.getState().bumpFindings();
      } catch (e) {
        setLoaded({ id: findingId, finding: before, error: null });
        toast("danger", updateFailure(e));
      }
    },
    [api, projectId, findingId, before],
  );

  const remove = useCallback(async () => {
    await deleteFinding(api, projectId, findingId);
    useChangesStore.getState().bumpFindings();
  }, [api, projectId, findingId]);

  return { finding: current?.finding ?? null, error: current?.error ?? null, update, remove };
}
