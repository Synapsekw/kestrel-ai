import { describe, it, expect } from "vitest";
import { errorBody, exampleProviders, fakeClient } from "@/test/fixtures";
import { deleteProviderKey, fetchProviders, setProviderKey, testProvider, updateProvider } from "./providers";

describe("providers api", () => {
  it("lists, patches, stores and removes a key, and tests", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      {
        method: "PATCH",
        path: /\/providers\/anthropic$/,
        body: { ...exampleProviders[1], requests_per_minute: 10 },
      },
      { method: "PUT", path: /\/providers\/openai\/key$/, status: 204 },
      { method: "DELETE", path: /\/providers\/openai\/key$/, status: 204 },
      {
        method: "POST",
        path: /\/providers\/anthropic\/test$/,
        body: { ok: true, message: "responded in 1.2 s", model_name: "claude-opus-5" },
      },
    ]);
    expect((await fetchProviders(api)).map((p) => p.name)).toEqual(["openai", "anthropic"]);
    expect((await updateProvider(api, "anthropic", { requests_per_minute: 10 })).requests_per_minute).toBe(
      10,
    );
    await setProviderKey(api, "openai", "sk-test");
    await deleteProviderKey(api, "openai");
    expect((await testProvider(api, "anthropic")).ok).toBe(true);
    expect(requests[1]).toMatchObject({
      method: "PATCH",
      url: "/api/v1/providers/anthropic",
      body: { requests_per_minute: 10 },
    });
    expect(requests[2]).toMatchObject({
      method: "PUT",
      url: "/api/v1/providers/openai/key",
      body: { api_key: "sk-test" },
    });
    expect(requests[3]).toMatchObject({
      method: "DELETE",
      url: "/api/v1/providers/openai/key",
      body: null,
    });
    expect(requests[4]).toMatchObject({ method: "POST", url: "/api/v1/providers/anthropic/test" });
  });

  it("surfaces 501 until S4 lands", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/providers$/,
        status: 501,
        body: errorBody("not_implemented", "providers arrive with S4"),
      },
    ]);
    await expect(fetchProviders(api)).rejects.toMatchObject({ code: "not_implemented", status: 501 });
  });
});
