// Spec §8 merge and split, as explicit operator actions (A3): split the current sighting off into a
// new finding; merge this finding into another one on the same model. Both answer synchronously.
import { useState } from "react";
import { mergeFinding, splitFinding, type FindingSighting } from "@/api/assetReview";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { Finding } from "@/api/findings";
import { formatFindingNumber } from "@/findings/format";
import { Button, Dialog, Field, Select, toast } from "@/ui";

export function FindingActions({
  projectId,
  finding,
  sightings,
  current,
  others,
  typeName,
  onChanged,
  onGo,
}: {
  projectId: string;
  finding: Finding;
  sightings: readonly FindingSighting[];
  current: FindingSighting | null;
  others: readonly Finding[];
  typeName(id: string): string | undefined;
  /** A split or merge changed the findings: reload the list, the placements and the sightings. */
  onChanged(): void;
  onGo(findingId: string): void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);
  const [into, setInto] = useState("");
  const label = formatFindingNumber(finding.number);
  // open findings only (a merged-away one is closed); same type first, then by number
  const candidates = [...others]
    .filter((f) => f.id !== finding.id && f.status !== "closed")
    .sort(
      (a, b) =>
        Number(b.type_id === finding.type_id) - Number(a.type_id === finding.type_id) || a.number - b.number,
    );

  const split = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const made = await splitFinding(api, projectId, finding.id, [current.id]);
      toast("ok", `Split this sighting into ${formatFindingNumber(made.number)}`);
      onChanged();
      onGo(made.id);
    } catch (e) {
      toast("danger", messageOf(e, "The sighting could not be split off."));
    } finally {
      setBusy(false);
    }
  };
  const target = candidates.some((f) => f.id === into) ? into : "";
  const merge = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const survivor = await mergeFinding(api, projectId, finding.id, target);
      toast("ok", `Merged ${label} into ${formatFindingNumber(survivor.number)}`);
      setMerging(false);
      onChanged();
      onGo(survivor.id);
    } catch (e) {
      toast("danger", messageOf(e, "The findings could not be merged."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        icon="minus"
        disabled={busy || !current || sightings.length < 2}
        onClick={() => void split()}
      >
        Split off this sighting
      </Button>
      <Button
        size="sm"
        icon="plus"
        disabled={busy || candidates.length === 0}
        onClick={() => setMerging(true)}
      >
        Merge into…
      </Button>
      <Dialog
        open={merging}
        title={`Merge ${label} into another finding`}
        description="Its sightings move to the finding you pick. This one is closed with a comment naming that finding; nothing is deleted."
        onClose={() => !busy && setMerging(false)}
        footer={
          <>
            <Button onClick={() => setMerging(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!target} onClick={() => void merge()}>
              Merge
            </Button>
          </>
        }
      >
        <Field label="Merge into" htmlFor="merge-into">
          <Select id="merge-into" value={target} onChange={(e) => setInto(e.target.value)}>
            <option value="">Pick a finding</option>
            {candidates.map((f) => (
              <option key={f.id} value={f.id}>
                {[formatFindingNumber(f.number), typeName(f.type_id), f.zone, f.side]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>
    </>
  );
}
