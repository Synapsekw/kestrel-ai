import { useState } from "react";
import type { AssetModel } from "@contract/client";
import { deleteAssetModel, patchAssetModel } from "@/api/assetModels";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { Alert, Button, Dialog, Field, Input } from "@/ui";

/**
 * An asset model's name, tag and type, and deleting it (with every version) after a confirm.
 * The name is required and never sent empty; an empty tag or type clears it.
 */
export function ModelDetailsDialog({
  projectId,
  model,
  onClose,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  model: AssetModel;
  onClose(): void;
  onSaved(model: AssetModel): void;
  onDeleted(model: AssetModel): void;
}) {
  const api = useApi();
  const [name, setName] = useState(model.name);
  const [tag, setTag] = useState(model.tag ?? "");
  const [type, setType] = useState(model.asset_type ?? "");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = { name: name.trim(), tag: tag.trim() || null, asset_type: type.trim() || null };
  const changed =
    body.name !== model.name ||
    body.tag !== (model.tag ?? null) ||
    body.asset_type !== (model.asset_type ?? null);

  const save = async () => {
    if (!body.name || !changed || busy) return;
    setBusy("save");
    setError(null);
    try {
      onSaved(await patchAssetModel(api, projectId, model.id, body));
    } catch (e) {
      setError(messageOf(e, "The details could not be saved."));
      setBusy(null);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy("delete");
    setError(null);
    try {
      await deleteAssetModel(api, projectId, model.id);
      onDeleted(model);
    } catch (e) {
      setError(messageOf(e, "The asset model could not be deleted."));
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      title="Asset model details"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          {!confirming && (
            <Button
              variant="danger"
              icon="trash"
              className="mr-auto"
              disabled={busy !== null}
              onClick={() => setConfirming(true)}
            >
              Delete asset model…
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={busy === "save"}
            disabled={!body.name || !changed || confirming || busy === "delete"}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Name"
          htmlFor="model-details-name"
          error={!body.name ? "An asset model needs a name." : undefined}
        >
          <Input
            id="model-details-name"
            autoFocus
            value={name}
            invalid={!body.name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tag" htmlFor="model-details-tag" hint="As on the drawings">
            <Input
              id="model-details-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="T-101"
            />
          </Field>
          <Field label="Asset type" htmlFor="model-details-type">
            <Input
              id="model-details-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Tank"
            />
          </Field>
        </div>
        {confirming && (
          <Alert
            tone="danger"
            title={`Delete ${model.name}?`}
            actions={
              <>
                <Button variant="danger" size="sm" loading={busy === "delete"} onClick={() => void remove()}>
                  Delete permanently
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === "delete"}
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </Button>
              </>
            }
          >
            Every version and its 3D model go with it. This can&apos;t be undone.
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
