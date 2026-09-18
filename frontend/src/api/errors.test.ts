import { describe, it, expect } from "vitest";
import { ApiFailure, codeOf, isNotImplemented, messageOf, unwrap } from "./errors";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("unwrap", () => {
  it("returns data on success", async () => {
    const data = await unwrap(Promise.resolve({ data: { ok: 1 }, response: json(200, { ok: 1 }) }));
    expect(data).toEqual({ ok: 1 });
  });

  it("resolves to undefined on 204", async () => {
    const data = await unwrap(
      Promise.resolve({ data: undefined, response: new Response(null, { status: 204 }) }),
    );
    expect(data).toBeUndefined();
  });

  it("throws ApiFailure with the envelope code, message and details", async () => {
    const envelope = {
      error: { code: "class_in_use", message: "class still has boxes", details: { box_count: 3 } },
    };
    const p = unwrap(Promise.resolve({ error: envelope, response: json(409, envelope) }));
    await expect(p).rejects.toBeInstanceOf(ApiFailure);
    await expect(p).rejects.toMatchObject({
      code: "class_in_use",
      status: 409,
      message: "class still has boxes",
      details: { box_count: 3 },
    });
  });

  it("falls back to http_error without an envelope", async () => {
    const p = unwrap(Promise.resolve({ error: "nope", response: new Response("nope", { status: 500 }) }));
    await expect(p).rejects.toMatchObject({ code: "http_error", status: 500 });
  });

  it("wraps a thrown fetch as a network failure", async () => {
    const p = unwrap(Promise.reject(new TypeError("Failed to fetch")));
    await expect(p).rejects.toMatchObject({ code: "network", status: 0, message: "Failed to fetch" });
  });
});

describe("messageOf / codeOf / isNotImplemented", () => {
  it("reads envelopes, failures and plain errors", () => {
    const envelope = { error: { code: "not_found", message: "gone", details: {} } };
    expect(messageOf(envelope, "x")).toBe("gone");
    expect(messageOf(new Error("boom"), "x")).toBe("boom");
    expect(messageOf(undefined, "fallback")).toBe("fallback");
    expect(codeOf(envelope)).toBe("not_found");
    expect(codeOf(new ApiFailure("conflict", "c", 409))).toBe("conflict");
    expect(codeOf("string")).toBeNull();
    expect(isNotImplemented(new ApiFailure("not_implemented", "later", 501))).toBe(true);
    expect(isNotImplemented(new ApiFailure("http_error", "later", 501))).toBe(true);
    expect(isNotImplemented(new ApiFailure("conflict", "c", 409))).toBe(false);
  });
});
