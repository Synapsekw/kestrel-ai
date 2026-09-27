import { useState } from "react";
import { messageOf } from "@/api/errors";
import { Alert, Button, Dialog, Field, Input, Segmented } from "@/ui";

export type ElevationRole = "dsm" | "dtm";

/** A survey date (maps) or a date and role (dem surfaces). An empty date clears it. */
export function SurveyDateDialog({
  title,
  initial,
  role,
  onSave,
  onClose,
}: {
  title: string;
  initial: string | null;
  role?: ElevationRole;
  onSave: (date: string | null, role?: ElevationRole) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initial ?? "");
  const [nextRole, setNextRole] = useState<ElevationRole | undefined>(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(date.trim() || null, nextRole);
      onClose();
    } catch (e) {
      setError(messageOf(e, "could not save the date"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save date
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Survey date" htmlFor="w2-survey-date">
          <Input id="w2-survey-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {nextRole && (
          <Segmented
            label="Elevation role"
            value={nextRole}
            onChange={setNextRole}
            options={[
              { value: "dsm", label: "DSM — surface incl. objects" },
              { value: "dtm", label: "DTM — bare ground" },
            ]}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
