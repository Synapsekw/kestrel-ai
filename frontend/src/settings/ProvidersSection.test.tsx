import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { errorBody, exampleProviders, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ProvidersSection } from "./ProvidersSection";

describe("ProvidersSection", () => {
  it("stores a key without echoing it, removes a key, tests and patches", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "PUT", path: /\/providers\/openai\/key$/, status: 204 },
      { method: "DELETE", path: /\/providers\/anthropic\/key$/, status: 204 },
      {
        method: "POST",
        path: /\/providers\/anthropic\/test$/,
        body: { ok: false, message: "no API key stored", model_name: "claude-opus-5" },
      },
      {
        method: "PATCH",
        path: /\/providers\/anthropic$/,
        body: { ...exampleProviders[1], requests_per_minute: 10 },
      },
    ]);
    renderWithProviders(<ProvidersSection />, { api });
    const openai = await screen.findByTestId("provider-openai");
    expect(within(openai).getByTestId("key-state-openai")).toHaveTextContent("No key stored");
    const keyInput = within(openai).getByLabelText("OpenAI API key");
    expect(keyInput).toHaveAttribute("type", "password");
    fireEvent.change(keyInput, { target: { value: "sk-secret" } });
    fireEvent.click(within(openai).getByRole("button", { name: "Save OpenAI key" }));
    await waitFor(() =>
      expect(within(openai).getByTestId("key-state-openai")).toHaveTextContent("Key stored"),
    );
    expect(keyInput).toHaveValue("");
    expect(requests[1]).toMatchObject({
      method: "PUT",
      url: "/api/v1/providers/openai/key",
      body: { api_key: "sk-secret" },
    });
    expect(document.body.textContent).not.toContain("sk-secret");

    const anthropic = screen.getByTestId("provider-anthropic");
    fireEvent.click(within(anthropic).getByRole("button", { name: "Test Anthropic" }));
    await waitFor(() =>
      expect(within(anthropic).getByRole("status")).toHaveTextContent("Failed: no API key stored"),
    );
    fireEvent.change(within(anthropic).getByLabelText("Anthropic requests per minute"), {
      target: { value: "10" },
    });
    fireEvent.click(within(anthropic).getByRole("button", { name: "Save Anthropic settings" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
      url: "/api/v1/providers/anthropic",
      body: { requests_per_minute: 10 },
    });
    fireEvent.click(within(anthropic).getByRole("button", { name: "Remove Anthropic key" }));
    await waitFor(() =>
      expect(within(anthropic).getByTestId("key-state-anthropic")).toHaveTextContent("No key stored"),
    );
    expect(requests.some((r) => r.method === "DELETE" && r.url === "/api/v1/providers/anthropic/key")).toBe(
      true,
    );
  });

  it("clears the key field even when storing fails, and tolerates 501", async () => {
    const failing = fakeClient([
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      {
        method: "PUT",
        path: /\/providers\/openai\/key$/,
        status: 500,
        body: errorBody("internal_error", "credential manager locked"),
      },
    ]);
    const first = renderWithProviders(<ProvidersSection />, { api: failing.api });
    const openai = await screen.findByTestId("provider-openai");
    const keyInput = within(openai).getByLabelText("OpenAI API key");
    fireEvent.change(keyInput, { target: { value: "sk-secret" } });
    fireEvent.click(within(openai).getByRole("button", { name: "Save OpenAI key" }));
    await waitFor(() =>
      expect(within(openai).getByRole("alert")).toHaveTextContent("credential manager locked"),
    );
    expect(keyInput).toHaveValue("");
    first.unmount();

    const stub = fakeClient([
      { method: "GET", path: /\/providers$/, status: 501, body: errorBody("not_implemented", "S4 later") },
    ]);
    renderWithProviders(<ProvidersSection />, { api: stub.api });
    expect(await screen.findByRole("note")).toHaveTextContent("Cloud providers are not available yet");
    expect(screen.getByRole("heading", { name: "Provider keys" })).toBeInTheDocument();
  });
});
