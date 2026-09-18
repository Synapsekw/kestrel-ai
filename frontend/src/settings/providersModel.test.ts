import { describe, it, expect } from "vitest";
import { exampleProviders } from "@/test/fixtures";
import { diffProvider, formOf } from "./providersModel";

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
