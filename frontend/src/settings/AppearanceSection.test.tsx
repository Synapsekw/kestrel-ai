import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import { readEffectsChoice } from "@/app/effects";
import { errorBody, fakeClient, fakeFetch, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { readMotionChoice } from "@/ui/motion";
import { AppearanceSection } from "./AppearanceSection";

const PUT_OK: FakeRoute = { method: "PUT", path: /\/settings\/operator$/, body: (r) => r.body as object };

/** `routes` go first, so a test can answer the GET itself (first match wins). */
function renderSection(name: string | null = null, routes: FakeRoute[] = [PUT_OK]) {
  const client = fakeClient([
    ...routes,
    { method: "GET", path: /\/settings\/operator$/, body: { operator_name: name } },
  ]);
  renderWithProviders(<AppearanceSection />, { api: client.api });
  return client;
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const puts = (requests: { method: string }[]) => requests.filter((r) => r.method === "PUT");

describe("AppearanceSection (F §4.3)", () => {
  beforeEach(() => window.localStorage.clear());

  it("switches visual effects and remembers the choice", () => {
    renderSection();
    expect(screen.getByRole("radio", { name: "Auto" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Reduced" }));
    expect(readEffectsChoice()).toBe("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(screen.getByRole("radio", { name: "Reduced" })).toBeChecked();
  });

  it("turns on reduced motion", () => {
    renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
    expect(readMotionChoice()).toBe("reduce");
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("shows the stored name and saves a new one through the backend when the field loses focus", async () => {
    const { requests } = renderSection("Ana");
    const input = screen.getByLabelText("Your name");
    await waitFor(() => expect(input).toHaveValue("Ana"));
    expect(input).toHaveAttribute("placeholder", "Operator");
    fireEvent.change(input, { target: { value: "Dana" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({ operator_name: "Dana" });
  });

  it("a blur without typing sends no PUT", async () => {
    const { requests } = renderSection("Ana");
    const input = screen.getByLabelText("Your name");
    await waitFor(() => expect(input).toHaveValue("Ana"));
    fireEvent.blur(input);
    await settle();
    expect(puts(requests)).toEqual([]);
    expect(screen.getByText("Shown on your comments.")).toBeInTheDocument();
  });

  it("when the stored name cannot be read, the empty field's blur does not clear it", async () => {
    const { requests } = renderSection(null, [
      { method: "GET", path: /\/settings\/operator$/, status: 500, body: errorBody("internal", "boom") },
      PUT_OK,
    ]);
    await waitFor(() => expect(requests.some((r) => r.method === "GET")).toBe(true));
    const input = screen.getByLabelText("Your name");
    expect(input).toHaveValue("");
    fireEvent.blur(input);
    await settle();
    expect(puts(requests)).toEqual([]);
  });

  it("a failed save says so", async () => {
    renderSection("Ana", [
      { method: "PUT", path: /\/settings\/operator$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    const input = screen.getByLabelText("Your name");
    await waitFor(() => expect(input).toHaveValue("Ana"));
    fireEvent.change(input, { target: { value: "Dana" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Could not save your name")).toBeInTheDocument();
  });

  it("saves once per change: a second blur after a successful save sends nothing", async () => {
    const { requests } = renderSection("Ana");
    const input = screen.getByLabelText("Your name");
    await waitFor(() => expect(input).toHaveValue("Ana"));
    fireEvent.change(input, { target: { value: "Dana" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    fireEvent.blur(input);
    await settle();
    expect(puts(requests)).toHaveLength(1);
  });

  it("typing before a slow read lands keeps the typed text", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { fetch: inner } = fakeFetch([
      { method: "GET", path: /\/settings\/operator$/, body: { operator_name: "Ana" } },
      PUT_OK,
    ]);
    const slow: typeof fetch = async (input, init) => {
      const method = input instanceof Request ? input.method : (init?.method ?? "GET");
      if (method === "GET") await gate;
      return inner(input, init);
    };
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: slow });
    renderWithProviders(<AppearanceSection />, { api });
    const input = screen.getByLabelText("Your name");
    fireEvent.change(input, { target: { value: "Dana" } });
    await act(async () => {
      release();
      await gate;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(input).toHaveValue("Dana");
  });
});
