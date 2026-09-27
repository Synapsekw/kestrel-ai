import { useCallback, useEffect, useRef, useState } from "react";
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
import { ownFindingsWrite } from "@/store/changesOwnWrite";
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
  // The revision this hook's own successful PATCH produced, for the finding it wrote: that bump
  // needs no re-read here, because the PATCH answer is already applied (rulings R8).
  const ownBump = useRef<{ findingId: string; revision: number } | null>(null);

  useEffect(() => {
    // Read-and-clear: the skip fires once, for the bump itself; switching away and back re-reads.
    const own = ownBump.current;
    ownBump.current = null;
    if (own && own.findingId === findingId && own.revision === revision) return;
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

  // Every write is id-guarded (the host may switch findings while a PATCH is in flight) and only
  // the newest write of a finding applies its saved answer; a refused one reverts only its own keys.
  const writeSeq = useRef(0);
  const update = useCallback(
    async (patch: FindingPatch) => {
      if (!before) return;
      const seq = ++writeSeq.current;
      const keys = Object.keys(patch) as (keyof FindingPatch)[];
      const onThis = (fn: (f: FindingDetail) => FindingDetail) =>
        setLoaded((prev) =>
          prev && prev.id === findingId && prev.finding ? { ...prev, finding: fn(prev.finding) } : prev,
        );
      onThis((f) => ({ ...f, ...patch }) as FindingDetail);
      try {
        await ownFindingsWrite([findingId], () => patchFinding(api, projectId, findingId, patch), {
          onSaved: (saved, rev) => {
            ownBump.current = { findingId, revision: rev };
            if (seq === writeSeq.current) onThis(() => saved);
          },
        });
      } catch (e) {
        onThis((f) => {
          const reverted: Record<string, unknown> = { ...f };
          for (const k of keys) if (f[k] === patch[k]) reverted[k] = before[k];
          return reverted as FindingDetail;
        });
        toast("danger", updateFailure(e));
      }
    },
    [api, projectId, findingId, before],
  );

  const remove = useCallback(async () => {
    await ownFindingsWrite([findingId], () => deleteFinding(api, projectId, findingId));
  }, [api, projectId, findingId]);

  return { finding: current?.finding ?? null, error: current?.error ?? null, update, remove };
}
