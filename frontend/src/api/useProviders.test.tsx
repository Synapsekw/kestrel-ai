import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleProviders, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { providerLabel, useProviders } from "./providers";

describe("useProviders", () => {
  it("loads the list, labels names and replaces one provider", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/providers$/, body: { items: exampleProviders } }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useProviders(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.providers.map((p) => p.name)).toEqual(["openai", "anthropic"]);
    act(() => result.current.replace({ ...exampleProviders[0], has_key: true }));
    expect(result.current.providers[0].has_key).toBe(true);
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel(null)).toBe("–");
  });

  it("marks providers unavailable on 501", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/providers$/, status: 501, body: errorBody("not_implemented", "S4 later") },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useProviders(), { wrapper });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
