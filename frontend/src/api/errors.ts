export interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/** Thrown by `unwrap` for any non-2xx response or transport failure. */
export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiFailure";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isEnvelope(v: unknown): v is ErrorEnvelope {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const err = (v as { error?: unknown }).error;
  return (
    typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
  );
}

/** "field: reason" per rejected field of a 422, or null when the details carry none. Inputs are never echoed. */
function validationText(details: Record<string, unknown> | undefined): string | null {
  const errors = details?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const parts = errors.map((e: { loc?: unknown[]; msg?: unknown }) => {
    const loc = (e.loc ?? [])
      .filter((p, i) => !(i === 0 && (p === "body" || p === "query" || p === "path")))
      .map((p) => (typeof p === "number" ? String(p + 1) : String(p)))
      .join(" ");
    return loc ? `${loc}: ${String(e.msg)}` : String(e.msg);
  });
  return parts.join("; ");
}

/** Human-readable message for an envelope, an ApiFailure, an Error or anything else. */
export function messageOf(err: unknown, fallback: string): string {
  if (isEnvelope(err)) {
    const { code, message, details } = err.error;
    return (code === "validation_error" && validationText(details)) || message;
  }
  if (err instanceof ApiFailure && err.code === "validation_error")
    return validationText(err.details) ?? err.message;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export function codeOf(err: unknown): string | null {
  if (isEnvelope(err)) return err.error.code;
  if (err instanceof ApiFailure) return err.code;
  return null;
}

/** 501 stubs exist until S3/S4 land; callers show a notice instead of an error. */
export function isNotImplemented(err: unknown): boolean {
  return codeOf(err) === "not_implemented" || (err instanceof ApiFailure && err.status === 501);
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Turns openapi-fetch's `{data, error, response}` into data-or-throw. A 204 resolves to `undefined`. */
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await call;
  } catch (e) {
    throw new ApiFailure("network", e instanceof Error ? e.message : String(e), 0);
  }
  if (result.response.ok) return result.data as T;
  const status = result.response.status;
  if (isEnvelope(result.error)) {
    const { code, message, details } = result.error.error;
    throw new ApiFailure(code, message, status, details ?? {});
  }
  throw new ApiFailure("http_error", `request failed with status ${status}`, status);
}
