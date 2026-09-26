import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { messageOf } from "@/api/errors";
import { useNow } from "@/jobs/useNow";
import {
  Alert,
  Button,
  Dialog,
  InspectorPane,
  InspectorSection,
  MenuButton,
  Pill,
  SeverityPicker,
  Skeleton,
  SkeletonRows,
  buttonClass,
  toast,
} from "@/ui";
import { formatFindingNumber, parseCreatedBy } from "./format";
import { Attachments } from "./inspector/Attachments";
import { Comments } from "./inspector/Comments";
import { StatusField, TypeField } from "./inspector/fields";
import { History } from "./inspector/History";
import { NoteField } from "./inspector/NoteField";
import { Provenance } from "./inspector/Provenance";
import { useFinding } from "./inspector/useFinding";
import { findingHref, findingPath, findingsTabPath } from "./links";
import { useProjectTypes } from "./useProjectTypes";

export interface FindingInspectorProps {
  projectId: string;
  findingId: string;
  /** Replaces the default "Open in workspace" link (I: "Show on image", M, C: their own). */
  anchorSlot?: ReactNode;
  /** Measured size (I), area or elevation (M), linked measurements (C). */
  measureSlot?: ReactNode;
  /** Called with the workspace link, or null once the finding is deleted; defaults to the router. */
  onNavigate?: (href: string | null) => void;
}

/** The shared finding inspector (F §8.7), reused by the Findings tab and by I, M and C. */
export function FindingInspector({
  projectId,
  findingId,
  anchorSlot,
  measureSlot,
  onNavigate,
}: FindingInspectorProps) {
  const navigate = useNavigate();
  const { finding, error, update, remove } = useFinding(projectId, findingId);
  const { types, defectTypes } = useProjectTypes(projectId);
  const nowMs = useNow(60_000);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const go = useCallback(
    (href: string | null) => {
      if (onNavigate) onNavigate(href);
      else void navigate(href ?? findingsTabPath(projectId));
    },
    [navigate, onNavigate, projectId],
  );

  if (error)
    return (
      <InspectorPane label="Finding" header={<span className="text-xs text-muted">Selected finding</span>}>
        <Alert tone="danger">{error}</Alert>
      </InspectorPane>
    );
  if (!finding)
    return (
      <InspectorPane label="Finding" header={<Skeleton className="h-4 w-28" />}>
        <SkeletonRows rows={6} columns={1} />
      </InspectorPane>
    );

  const number = formatFindingNumber(finding.number);
  const by = parseCreatedBy(finding.created_by);
  const href = findingHref(projectId, finding);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(findingPath(projectId, findingId));
      toast("ok", `Link to ${number} copied`);
    } catch {
      toast("danger", "Could not copy the link");
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await remove();
      setConfirming(false);
      toast("ok", `${number} deleted`);
      go(null);
    } catch (e) {
      toast("danger", messageOf(e, "could not delete the finding"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <InspectorPane
        label={`Finding ${number}`}
        header={
          <>
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-xs text-muted">Selected finding</span>
              <span className="font-mono text-xs font-semibold text-ink">{number}</span>
              <Pill size="sm" tone={by.kind === "model" ? "accent" : "neutral"}>
                {by.kind === "model" ? "AI" : "Manual"}
              </Pill>
            </div>
            <MenuButton
              label="Finding actions"
              iconOnly
              icon="list"
              size="sm"
              variant="ghost"
              items={[
                { id: "copy", label: "Copy link", icon: "external", onSelect: () => void copyLink() },
                {
                  id: "delete",
                  label: "Delete",
                  icon: "trash",
                  danger: true,
                  onSelect: () => setConfirming(true),
                },
              ]}
            />
          </>
        }
        footer={
          anchorSlot ?? (
            <Link
              to={href}
              onClick={(e) => {
                if (!onNavigate) return;
                e.preventDefault();
                onNavigate(href);
              }}
              className={buttonClass("secondary", "md", "w-full justify-center")}
            >
              Open in workspace
            </Link>
          )
        }
      >
        <InspectorSection title="Type">
          <TypeField
            type={types.get(finding.type_id) ?? null}
            defectTypes={defectTypes}
            onChange={(typeId) => void update({ type_id: typeId })}
          />
        </InspectorSection>
        <InspectorSection title="Severity">
          <SeverityPicker
            allowNone
            value={finding.severity}
            onChange={(level) => void update({ severity: level })}
          />
        </InspectorSection>
        <InspectorSection title="Status">
          <StatusField value={finding.status} onChange={(status) => void update({ status })} />
        </InspectorSection>
        {measureSlot && <InspectorSection title="Measured size">{measureSlot}</InspectorSection>}
        <Provenance finding={finding} nowMs={nowMs} />
        <InspectorSection title="Note">
          <NoteField
            key={finding.id}
            projectId={projectId}
            findingId={finding.id}
            initial={finding.note}
            number={finding.number}
          />
        </InspectorSection>
        <InspectorSection title={`Attached photos · ${finding.attachment_count}`}>
          <Attachments projectId={projectId} findingId={finding.id} />
        </InspectorSection>
        <InspectorSection title={`Comments · ${finding.comment_count}`}>
          <Comments projectId={projectId} findingId={finding.id} />
        </InspectorSection>
        <InspectorSection title="History">
          <History projectId={projectId} findingId={finding.id} />
        </InspectorSection>
      </InspectorPane>
      <Dialog
        open={confirming}
        title={`Delete ${number}?`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
              {`Delete ${number}`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Its photos and comments go with it.
          {finding.anchor.kind === "image" ? " Its box on the image is deleted too." : ""}
        </p>
      </Dialog>
    </>
  );
}
