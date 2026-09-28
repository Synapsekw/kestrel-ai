import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings, type Finding } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useCatalogue } from "@/catalogue/useCatalogue";
import { formatFindingNumber } from "@/findings/format";
import { useChangesStore } from "@/store/changes";
import { Combobox, type ComboItem } from "@/ui";

/** One page of this cloud's findings: the attach list is a bounded read (spec §13). */
export const FINDINGS_ATTACH_MAX = 500;
const NONE_ID = "none";

export function AttachFinding({
  projectId,
  cloudId,
  value,
  onChange,
}: {
  projectId: string;
  cloudId: string;
  value: string | null;
  onChange: (findingId: string | null) => void;
}) {
  const api = useApi();
  const { types } = useCatalogue();
  const revision = useChangesStore((s) => s.findingsRevision);
  const key = `${projectId}|${cloudId}|${revision}`;
  const [found, setFound] = useState<{ key: string; items: Finding[] } | null>(null);

  useEffect(() => {
    let current = true;
    listFindings(api, projectId, {
      anchor_kind: ["cloud"],
      data_id: cloudId,
      sort: "number",
      limit: FINDINGS_ATTACH_MAX,
    })
      .then((page) => {
        if (current) setFound({ key, items: page.items });
      })
      .catch((e: unknown) => {
        if (current) pushLog(`attach list failed: ${messageOf(e, String(e))}`);
      });
    return () => {
      current = false;
    };
  }, [api, projectId, cloudId, key]);

  const findings = found?.key === key ? found.items : [];
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const items: ComboItem[] = [
    { id: NONE_ID, label: "No finding" },
    ...findings.map((f) => ({
      id: f.id,
      label: `${formatFindingNumber(f.number)} · ${typeName.get(f.type_id) ?? "Finding"}`,
      hint: f.note || undefined,
    })),
  ];
  if (value && !findings.some((f) => f.id === value)) items.push({ id: value, label: "Attached finding" });
  return (
    <Combobox
      label="Attach to finding"
      items={items}
      value={value ?? NONE_ID}
      onChange={(id) => onChange(id === NONE_ID ? null : id)}
      triggerPlaceholder="Attach to finding…"
      emptyText="No findings pinned on this cloud"
    />
  );
}
