import { useState } from "react";
import type { AssetModel } from "@contract/client";
import { createAssetModel } from "@/api/assetModels";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { Button, Dialog, Field, Input } from "@/ui";

/** Name, tag and type of a new, empty asset model; its versions come from a build or an edit. */
export function NewModelDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose(): void;
  onCreated(model: AssetModel): void;
}) {
  const api = useApi();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createAssetModel(api, projectId, {
          name: name.trim(),
          tag: tag.trim() || null,
          asset_type: type.trim() || null,
        }),
      );
    } catch (e) {
      setError(messageOf(e, "The asset model could not be created."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="New asset model"
      description="A 3D model of one asset, built from its drawings, scans and photos."
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="new-model-name" error={error ?? undefined}>
          <Input
            id="new-model-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Feed tank"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tag" htmlFor="new-model-tag" hint="As on the drawings">
            <Input
              id="new-model-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="T-101"
            />
          </Field>
          <Field label="Asset type" htmlFor="new-model-type">
            <Input
              id="new-model-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Tank"
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
