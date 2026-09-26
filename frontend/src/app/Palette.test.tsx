import createClient from "openapi-fetch";
import type { ApiClient, paths } from "@contract/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import {
  errorBody,
  exampleClasses,
  exampleProject,
  fakeClient,
  PROJECT_ID,
  type FakeRoute,
  type RecordedRequest,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useCommandRegistry, useCommands } from "./commands";
import { Palette } from "./Palette";

/**
 * The palette's search sources pass DS `CommandPalette`'s own `AbortController` signal through
 * `unwrap(api.GET(...))`. Under Vitest's jsdom environment, `openapi-fetch`'s internal
 * `new Request(url, { signal })` throws ("Expected signal to be an instance of AbortSignal") for
 * *any* real signal — jsdom's bundled, private `undici` validates against its own `AbortSignal`
 * class, not the DOM one `new AbortController()` returns — regardless of which `fetch` is
 * supplied (reproduces with a bare `new Request(url, {signal: new AbortController().signal})`, no
 * app code involved). It's a test-environment-only defect (a real browser/webview agrees), so this
 * file's client is built with a plain-object `Request` stand-in instead of `globalThis.Request`.
 */
class SafeRequest {
  readonly url: string;
  readonly method: string;
  readonly signal?: AbortSignal | null;
  constructor(url: string, init: RequestInit = {}) {
    this.url = url;
    this.method = init.method ?? "GET";
    this.signal = init.signal;
  }
}

function signalSafeClient(routes: FakeRoute[]): { api: ApiClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: unknown) => {
    const req = input as SafeRequest;
    const url = new URL(req.url);
    const rec: RecordedRequest = { method: req.method, url: url.pathname + url.search, body: null };
    requests.push(rec);
    const route = routes.find((r) => r.method === req.method && r.path.test(url.pathname));
    if (!route) {
      return new Response(
        JSON.stringify(errorBody("not_found", `no fake route for ${req.method} ${url.pathname}`)),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const status = route.status ?? 200;
    const payload = typeof route.body === "function" ? route.body(rec) : route.body;
    if (status === 204 || payload === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const api = createClient<paths>({
    baseUrl: "http://fake",
    fetch: fetchImpl,
    Request: SafeRequest as unknown as typeof Request,
  });
  return { api: api as ApiClient, requests };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function ScreenWithCommand({ run }: { run: () => void }) {
  useCommands([{ id: "tool:box", title: "Box tool", run }]);
  return null;
}

function renderPalette(path: string, extra?: ReactNode) {
  const onClose = vi.fn();
  const { api } = signalSafeClient([
    {
      method: "GET",
      path: /\/projects$/,
      body: {
        items: [exampleProject, { ...exampleProject, id: "p2", name: "North site" }],
        next_cursor: null,
      },
    },
    {
      method: "GET",
      path: /\/search$/,
      body: { findings: [{ id: "f1", number: 217, type_id: exampleClasses[0].id, note: "Crack" }], data: [] },
    },
  ]);
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <Palette open onClose={onClose} project={exampleProject} />
            {extra}
            <Where />
          </>
        }
      />
    </Routes>,
    { api, route: path },
  );
  return onClose;
}

describe("Palette", () => {
  beforeEach(() => useCommandRegistry.setState({ entries: [] }));

  it("goes to a tab by name with the keyboard", async () => {
    const onClose = renderPalette(`/p/${PROJECT_ID}/images`);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Findings" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/findings`));
    expect(onClose).toHaveBeenCalled();
  });

  it("lists the other recent projects", async () => {
    renderPalette(`/p/${PROJECT_ID}/images`);
    expect(await screen.findByRole("option", { name: /North site/ })).toBeInTheDocument();
  });

  it("searches the project's findings from two characters", async () => {
    renderPalette(`/p/${PROJECT_ID}/images`);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cr" } });
    const hit = await screen.findByRole("option", { name: new RegExp(`F-0217 · ${exampleClasses[0].name}`) });
    fireEvent.click(hit);
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/findings/f1`),
    );
  });

  it("includes the commands a mounted screen registered", async () => {
    const run = vi.fn();
    renderPalette(`/p/${PROJECT_ID}/images`, <ScreenWithCommand run={run} />);
    fireEvent.click(await screen.findByRole("option", { name: /Box tool/ }));
    expect(run).toHaveBeenCalled();
  });

  it("skips recent projects that don't open (a missing folder or an unfinished upgrade)", async () => {
    const onClose = vi.fn();
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/projects$/,
        body: {
          items: [
            exampleProject,
            { ...exampleProject, id: "p2", name: "North site", availability: "missing" },
            {
              ...exampleProject,
              id: "p3",
              name: "Upgrading site",
              migration: { ...exampleProject.migration, state: "queued" },
            },
            { ...exampleProject, id: "p4", name: "Valid site" },
          ],
          next_cursor: null,
        },
      },
      { method: "GET", path: /\/search$/, body: { findings: [], data: [] } },
    ]);
    renderWithProviders(
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Palette open onClose={onClose} project={exampleProject} />
              <Where />
            </>
          }
        />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/images` },
    );
    // Confirms the async recent-projects fetch actually resolved and was applied, not just an
    // early assertion that would pass trivially while the request is still pending.
    expect(await screen.findByRole("option", { name: /Valid site/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /North site/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Upgrading site/ })).not.toBeInTheDocument();
  });
});
