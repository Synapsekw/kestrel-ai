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

describe("validation errors", () => {
  const body = {
    error: {
      code: "validation_error",
      message: "request validation failed",
      details: {
        errors: [
          {
            loc: ["body", "folder"],
            msg: "String should have at least 1 character",
            type: "string_too_short",
          },
          { loc: ["body", "classes", 0, "name"], msg: "Field required", type: "missing" },
        ],
      },
    },
  };

  it("names the fields and the reasons instead of the bare envelope message", () => {
    expect(messageOf(body, "x")).toBe(
      "folder: String should have at least 1 character; classes 1 name: Field required",
    );
  });

  it("does the same for a thrown ApiFailure", () => {
    const failure = new ApiFailure("validation_error", "request validation failed", 422, body.error.details);
    expect(messageOf(failure, "x")).toBe(
      "folder: String should have at least 1 character; classes 1 name: Field required",
    );
  });

  it("falls back to the message when the details carry no errors", () => {
    expect(
      messageOf(
        { error: { code: "validation_error", message: "request validation failed", details: {} } },
        "x",
      ),
    ).toBe("request validation failed");
  });
});
