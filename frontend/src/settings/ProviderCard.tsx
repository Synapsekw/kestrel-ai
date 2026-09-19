import { useState, type FormEvent } from "react";
import type { Provider } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import {
  deleteProviderKey,
  providerLabel,
  setProviderKey,
  testProvider,
  updateProvider,
} from "@/api/providers";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Field, Input, Pill } from "@/ui";
import { diffProvider, formOf, testFailureText } from "./providersModel";

interface Props {
  provider: Provider;
  onChanged: (p: Provider) => void;
}

/**
 * One cloud provider as a row (spec section 8): model name, rate limit and cost estimate through PATCH;
 * the API key goes to Windows Credential Manager through PUT and is dropped from state right after the
 * request.
 */
export function ProviderCard({ provider, onChanged }: Props) {
  const api = useApi();
  const name = providerLabel(provider.name);
  const id = `provider-${provider.name}`;
  // Keyed by provider name: the form keeps the user's edits and is refreshed from each PATCH answer.
  const [form, setForm] = useState(() => formOf(provider));
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(what: string, fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setStatus(await fn());
    } catch (e) {
      // The provider name only: an API key must never reach the diagnostics log.
      pushLog(`${what} for ${provider.name} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, `${what} failed`));
    } finally {
      setBusy(false);
    }
  }

  function saveSettings(e: FormEvent) {
    e.preventDefault();
    const { patch, error: problem } = diffProvider(form, provider);
    if (problem) {
      setError(problem);
      return;
    }
    if (!patch) {
      setStatus("Nothing to save");
      return;
    }
    void run("save settings", async () => {
      const saved = await updateProvider(api, provider.name, patch);
      setForm(formOf(saved));
      onChanged(saved);
      return `${name} settings saved`;
    });
  }

  function saveKey(e: FormEvent) {
    e.preventDefault();
    const key = apiKey;
    setApiKey("");
    if (!key.trim()) {
      setError("Paste the API key first.");
      return;
    }
    void run("store key", async () => {
      await setProviderKey(api, provider.name, key.trim());
      onChanged({ ...provider, has_key: true });
      return "Key stored in Windows Credential Manager";
    });
  }

  const removeKey = () =>
    run("remove key", async () => {
      await deleteProviderKey(api, provider.name);
      onChanged({ ...provider, has_key: false });
      return "Key removed";
    });

  const test = () =>
    run("test", async () => {
      const r = await testProvider(api, provider.name);
      if (r.ok) return `OK: ${r.message} (${r.model_name})`;
      setError(testFailureText(name, r.message));
      return null;
    });

  return (
    <div data-testid={`provider-${provider.name}`} className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">{name}</h3>
        <Pill tone={provider.has_key ? "ok" : "neutral"} data-testid={`key-state-${provider.name}`}>
          {provider.has_key ? "Key stored" : "No key stored"}
        </Pill>
        <Button variant="ghost" size="sm" onClick={() => void test()} disabled={busy} className="ml-auto">
          Test {name}
        </Button>
      </div>
      <form onSubmit={saveKey} className="flex flex-wrap items-end gap-2" noValidate>
        <Field label="API key" htmlFor={`${id}-key`} className="w-full max-w-sm">
          <Input
            id={`${id}-key`}
            aria-label={`${name} API key`}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider.has_key ? "Paste a new key to replace the stored one" : "Paste the API key"}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          Save {name} key
        </Button>
        <Button variant="danger" onClick={() => void removeKey()} disabled={busy || !provider.has_key}>
          Remove {name} key
        </Button>
      </form>
      <form onSubmit={saveSettings} className="flex flex-wrap items-end gap-2" noValidate>
        <Field label="Model name" htmlFor={`${id}-model`} className="w-full max-w-[14rem]">
          <Input
            id={`${id}-model`}
            aria-label={`${name} model name`}
            value={form.model_name}
            onChange={(e) => setForm({ ...form, model_name: e.target.value })}
          />
        </Field>
        <Field label="Requests per minute" htmlFor={`${id}-rpm`} className="w-32">
          <Input
            id={`${id}-rpm`}
            aria-label={`${name} requests per minute`}
            type="number"
            min={1}
            max={10000}
            value={form.requests_per_minute}
            onChange={(e) => setForm({ ...form, requests_per_minute: e.target.value })}
          />
        </Field>
        <Field label="Cost per request (USD)" htmlFor={`${id}-cost`} className="w-36">
          <Input
            id={`${id}-cost`}
            aria-label={`${name} cost per request`}
            type="number"
            min={0}
            step={0.001}
            value={form.cost_per_request}
            onChange={(e) => setForm({ ...form, cost_per_request: e.target.value })}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          Save {name} settings
        </Button>
      </form>
      {status && (
        <Alert tone="ok" role="status">
          {status}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
