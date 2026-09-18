import type { Provider } from "@contract/client";
import type { ProviderUpdate } from "@/api/providers";

export interface ProviderForm {
  model_name: string;
  requests_per_minute: string;
  cost_per_request: string;
}

export function formOf(p: Provider): ProviderForm {
  return {
    model_name: p.model_name,
    requests_per_minute: String(p.requests_per_minute),
    cost_per_request: String(p.cost_per_request),
  };
}

/** Validates the form and returns only the fields that differ from `current` (null when nothing changed). */
export function diffProvider(
  form: ProviderForm,
  current: Provider,
): { patch: ProviderUpdate | null; error: string | null } {
  const model_name = form.model_name.trim();
  if (!model_name) return { patch: null, error: "Model name is required." };
  const rpmText = form.requests_per_minute.trim();
  const requests_per_minute = /^\d+$/.test(rpmText) ? Number(rpmText) : Number.NaN;
  if (!Number.isFinite(requests_per_minute) || requests_per_minute < 1 || requests_per_minute > 10000) {
    return { patch: null, error: "Requests per minute must be a whole number from 1 to 10000." };
  }
  const costText = form.cost_per_request.trim();
  const cost_per_request = costText === "" ? Number.NaN : Number(costText);
  if (!Number.isFinite(cost_per_request) || cost_per_request < 0) {
    return { patch: null, error: "Cost per request must be 0 or more." };
  }
  const patch: ProviderUpdate = {};
  if (model_name !== current.model_name) patch.model_name = model_name;
  if (requests_per_minute !== current.requests_per_minute) patch.requests_per_minute = requests_per_minute;
  if (cost_per_request !== current.cost_per_request) patch.cost_per_request = cost_per_request;
  return { patch: Object.keys(patch).length > 0 ? patch : null, error: null };
}
