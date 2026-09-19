import { describe, it, expect } from "vitest";
import { exampleProviders } from "@/test/fixtures";
import { diffProvider, formOf, testFailureText } from "./providersModel";

const anthropic = exampleProviders[1];

describe("provider form model", () => {
  it("maps a provider to strings and back to a patch of changed fields only", () => {
    const form = formOf(anthropic);
    expect(form).toEqual({
      model_name: "claude-opus-5",
      requests_per_minute: "30",
      cost_per_request: "0.02",
    });
    expect(diffProvider(form, anthropic)).toEqual({ patch: null, error: null });
    expect(diffProvider({ ...form, requests_per_minute: "10" }, anthropic)).toEqual({
      patch: { requests_per_minute: 10 },
      error: null,
    });
    expect(
      diffProvider(
        { model_name: "claude-sonnet-5", requests_per_minute: "30", cost_per_request: "0.01" },
        anthropic,
      ),
    ).toEqual({
      patch: { model_name: "claude-sonnet-5", cost_per_request: 0.01 },
      error: null,
    });
  });

  it("validates", () => {
    const form = formOf(anthropic);
    expect(diffProvider({ ...form, model_name: " " }, anthropic).error).toBe("Model name is required.");
    expect(diffProvider({ ...form, requests_per_minute: "0" }, anthropic).error).toBe(
      "Requests per minute must be a whole number from 1 to 10000.",
    );
    expect(diffProvider({ ...form, cost_per_request: "-1" }, anthropic).error).toBe(
      "Cost per request must be 0 or more.",
    );
    expect(diffProvider({ ...form, cost_per_request: "" }, anthropic).error).toBe(
      "Cost per request must be 0 or more.",
    );
  });
});

describe("testFailureText", () => {
  it("says in plain words that the provider rejected the key", () => {
    const raw =
      "ProviderError: anthropic returned 401: Error code: 401 - {'type': 'error', 'error': {'type': 'authentication_error'}}";
    expect(testFailureText("Anthropic", raw)).toBe(
      "Anthropic rejected the key (401). Check that it was pasted completely and is still active.",
    );
    expect(testFailureText("OpenAI", "ProviderError: openai returned 403: forbidden")).toMatch(
      /^OpenAI rejected the key \(403\)/,
    );
  });

  it("names a missing key, an unreachable provider and an unknown model", () => {
    expect(testFailureText("OpenAI", "no API key stored")).toBe(
      "No OpenAI key is stored yet. Paste one above and save it.",
    );
    expect(testFailureText("Anthropic", "ProviderError: could not reach anthropic: APIConnectionError")).toBe(
      "Could not reach Anthropic. Check the internet connection.",
    );
    expect(testFailureText("Anthropic", "ProviderError: anthropic returned 404: model: claude-x")).toBe(
      "Anthropic does not know the model name (404). Correct it above and save the settings.",
    );
  });

  it("keeps an unrecognised message, without the Python class prefix", () => {
    expect(testFailureText("OpenAI", "ProviderError: openai returned 500: boom")).toBe(
      "The OpenAI test failed: openai returned 500: boom",
    );
  });
});
