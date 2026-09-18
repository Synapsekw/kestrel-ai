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
import { diffProvider, formOf } from "./providersModel";

interface Props {
  provider: Provider;
  onChanged: (p: Provider) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-400";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

/**
 * One cloud provider (spec section 8): model name, rate limit and cost estimate through PATCH; the API key
 * goes to Windows Credential Manager through PUT and is dropped from state right after the request.
 */
export function ProviderCard({ provider, onChanged }: Props) {
  const api = useApi();
  const name = providerLabel(provider.name);
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
      return r.ok ? `OK: ${r.message} (${r.model_name})` : `Failed: ${r.message}`;
    });

  return (
    <section
      data-testid={`provider-${provider.name}`}
      className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      <header className="flex items-center gap-2">
        <h3 className="text-base font-medium">{name}</h3>
        <span
          data-testid={`key-state-${provider.name}`}
          className={`rounded px-2 py-0.5 text-xs ${provider.has_key ? "bg-emerald-800 text-emerald-100" : "bg-slate-700 text-slate-300"}`}
        >
          {provider.has_key ? "Key stored" : "No key stored"}
        </span>
      </header>
      <form onSubmit={saveSettings} className="flex flex-wrap items-end gap-3">
        <label className={label}>
          Model name
          <input
            aria-label={`${name} model name`}
            value={form.model_name}
            onChange={(e) => setForm({ ...form, model_name: e.target.value })}
            className={input}
          />
        </label>
        <label className={label}>
          Requests per minute
          <input
            aria-label={`${name} requests per minute`}
            type="number"
            min={1}
            max={10000}
            value={form.requests_per_minute}
            onChange={(e) => setForm({ ...form, requests_per_minute: e.target.value })}
            className={`${input} w-24`}
          />
        </label>
        <label className={label}>
          Cost per request (USD)
          <input
            aria-label={`${name} cost per request`}
            type="number"
            min={0}
            step={0.001}
            value={form.cost_per_request}
            onChange={(e) => setForm({ ...form, cost_per_request: e.target.value })}
            className={`${input} w-24`}
          />
        </label>
        <button type="submit" className={secondary} disabled={busy}>
          Save {name} settings
        </button>
      </form>
      <form onSubmit={saveKey} className="flex flex-wrap items-end gap-3">
        <label className={label}>
          API key
          <input
            aria-label={`${name} API key`}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider.has_key ? "Paste a new key to replace the stored one" : "Paste the API key"}
            className={`${input} w-72`}
          />
        </label>
        <button type="submit" className={primary} disabled={busy}>
          Save {name} key
        </button>
        <button
          type="button"
          className={secondary}
          onClick={() => void removeKey()}
          disabled={busy || !provider.has_key}
        >
          Remove {name} key
        </button>
        <button type="button" className={secondary} onClick={() => void test()} disabled={busy}>
          Test {name}
        </button>
      </form>
      {status && (
        <p role="status" className="text-xs text-emerald-300">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
