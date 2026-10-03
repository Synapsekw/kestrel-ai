import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { exampleImage, fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { MODEL, VERSION_2 } from "@/test/assetModelFixtures";
import { pdfDrawing } from "@/mapws/drawings/testFixtures";
import { BuildDialog } from "./BuildDialog";

const provider = (name: string, model_name: string, has_key: boolean) => ({
  name,
  model_name,
  has_key,
  requests_per_minute: 30,
  cost_per_request: 0.02,
});
const providers = {
  items: [
    provider("openai", "gpt-5", false),
    provider("anthropic", "claude-opus-5-5", true),
    provider("gemini", "gemini-2.5-pro", true),
  ],
};
const item = (id: string, type: string, label: string, status: string) => ({
  id,
  type,
  label,
  status,
  captured_on: null,
  created_at: "2026-10-01T09:00:00Z",
  summary: {},
});
const drawing = (id: string, name: string, source_path: string, page: number | null, status: string) => ({
  ...pdfDrawing,
  id,
  name,
  source_path,
  page,
  status,
});
const drawingRows = {
  items: [
    drawing("d1", "GA drawing", "D:\\plans\\ga.pdf", 1, "ready"),
    drawing("d2", "Importing", "D:\\plans\\other.pdf", 1, "importing"),
  ],
};
const clouds = { items: [item("c1", "point_cloud", "May survey cloud", "ready")], next_cursor: null };

function setup(extra: unknown[] = []) {
  return fakeClient([
    ...extra,
    { method: "GET", path: /\/providers$/, body: providers },
    { method: "GET", path: /\/drawings$/, body: drawingRows },
    { method: "GET", path: /\/drawings\/unimported$/, body: { files: [] } },
    {
      method: "GET",
      path: /\/data$/,
      body: (req: RecordedRequest) =>
        req.url.includes("type=point_cloud") ? clouds : { items: [], next_cursor: null },
    },
    { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
  ] as never);
}

describe("BuildDialog", () => {
  it("starts a build with the picked sources, provider and notes", async () => {
    const { api, requests } = setup([
      {
        method: "POST",
        path: /\/runs$/,
        status: 202,
        body: {
          run: { id: "r1", state: "running" },
          job: { id: "j1", type: "asset_model_run", state: "queued" },
        },
      },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(
      <BuildDialog
        open
        onClose={() => {}}
        projectId={PROJECT_ID}
        model={MODEL}
        mode="build"
        onStarted={onStarted}
      />,
      { api },
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: /ga drawing/i }));
    expect(screen.getByRole("checkbox", { name: /importing/i })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("radio", { name: /openai/i })).toBeDisabled());
    fireEvent.click(screen.getByRole("radio", { name: /gemini/i }));
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "N7 is at 270°" } });
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const body = requests.find((r) => r.method === "POST")!.body;
    expect(body).toEqual({
      mode: "build",
      provider: "gemini",
      model_name: "gemini-2.5-pro",
      sources: [{ type: "drawing", id: "d1" }],
      notes: "N7 is at 270°",
    });
  });

  it("defaults to Anthropic, offers a link to App settings for a provider without a key", async () => {
    const { api } = setup();
    renderWithProviders(
      <BuildDialog
        open
        onClose={() => {}}
        projectId={PROJECT_ID}
        model={MODEL}
        mode="build"
        onStarted={() => {}}
      />,
      { api },
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: /anthropic/i })).toBeChecked());
    expect(screen.getByLabelText(/^model$/i)).toHaveValue("claude-opus-5-5");
    expect(screen.getByRole("link", { name: /add a key in app settings/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("reads photos a page at a time and filters them on the server", async () => {
    const page1 = {
      items: [exampleImage],
      next_cursor: "c2",
      total: 2,
    };
    const { api, requests } = setup([
      {
        method: "GET",
        path: /\/images$/,
        body: (req: RecordedRequest) =>
          req.url.includes("cursor=c2")
            ? { items: [{ ...exampleImage, id: "i2", file_name: "second.jpg" }], next_cursor: null, total: 2 }
            : page1,
      },
    ]);
    renderWithProviders(
      <BuildDialog
        open
        onClose={() => {}}
        projectId={PROJECT_ID}
        model={MODEL}
        mode="build"
        onStarted={() => {}}
      />,
      { api },
    );
    expect(
      await screen.findByRole("checkbox", { name: new RegExp(exampleImage.file_name) }),
    ).toBeInTheDocument();
    const first = requests.find((r) => r.url.includes("/images"))!;
    expect(first.url).toMatch(/limit=200/);
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(await screen.findByRole("checkbox", { name: /second\.jpg/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/filter photos/i), { target: { value: "0031" } });
    await waitFor(() => expect(requests.some((r) => /\/images\?.*search=0031/.test(r.url))).toBe(true));
  });

  it("refine starts from the current version's sources", async () => {
    const { api } = setup([
      { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [VERSION_2] } },
    ]);
    renderWithProviders(
      <BuildDialog
        open
        onClose={() => {}}
        projectId={PROJECT_ID}
        model={MODEL}
        mode="refine"
        onStarted={() => {}}
      />,
      { api },
    );
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /ga drawing/i })).toBeChecked());
    expect(screen.getByRole("button", { name: /start refine/i })).toBeEnabled();
  });

  it("shows the server's reason when the run can't start", async () => {
    const { api } = setup([
      {
        method: "POST",
        path: /\/runs$/,
        status: 409,
        body: { error: { code: "job_running", message: "x", details: {} } },
      },
    ]);
    renderWithProviders(
      <BuildDialog
        open
        onClose={() => {}}
        projectId={PROJECT_ID}
        model={MODEL}
        mode="build"
        onStarted={() => {}}
      />,
      { api },
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: /ga drawing/i }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /anthropic/i })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    expect(await screen.findByText(/already building this model/i)).toBeInTheDocument();
  });

  it("can't start without a source", async () => {
    const { api } = setup();
    renderWithProviders(
      <BuildDialog
        open
        onClose={() => {}}
        projectId={PROJECT_ID}
        model={MODEL}
        mode="build"
        onStarted={() => {}}
      />,
      { api },
    );
    expect(await screen.findByRole("button", { name: /start build/i })).toBeDisabled();
  });
  const open = (
    api: Parameters<typeof renderWithProviders>[1]["api"],
    props: Partial<Parameters<typeof BuildDialog>[0]> = {},
  ) =>
    renderWithProviders(
      <BuildDialog
        open
        onClose={() => {}}
        projectId={PROJECT_ID}
        model={MODEL}
        mode="build"
        onStarted={() => {}}
        {...props}
      />,
      { api },
    );
  const POSTED = {
    method: "POST",
    path: /\/runs$/,
    status: 202,
    body: {
      run: { id: "r1", state: "running" },
      job: { id: "j1", type: "asset_model_run", state: "queued" },
    },
  };

  it("shows a PDF's pages as one file and sends every page", async () => {
    const pages = {
      items: [
        drawing("p2", "T0005 · p2", "E:\\LNG\\T0005.pdf", 2, "ready"),
        drawing("p1", "T0005 · p1", "E:\\LNG\\T0005.pdf", 1, "ready"),
      ],
    };
    const { api, requests } = setup([{ method: "GET", path: /\/drawings$/, body: pages }, POSTED]);
    open(api);
    const file = await screen.findByRole("checkbox", { name: /T0005\.pdf/ });
    expect(screen.getByText("2 pages")).toBeInTheDocument();
    fireEvent.click(file);
    await waitFor(() => expect(screen.getByRole("button", { name: /start build/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect((requests.find((r) => r.method === "POST")!.body as { sources: unknown }).sources).toEqual([
      { type: "drawing", id: "p1" },
      { type: "drawing", id: "p2" },
    ]);
  });

  it("a refine that used one page shows the file partly chosen; unticking drops every page", async () => {
    const pages = {
      items: [
        drawing("p1", "T0005 · p1", "E:\\LNG\\T0005.pdf", 1, "ready"),
        drawing("p2", "T0005 · p2", "E:\\LNG\\T0005.pdf", 2, "ready"),
      ],
    };
    const { api } = setup([{ method: "GET", path: /\/drawings$/, body: pages }]);
    open(api, { initial: { sources: [{ type: "drawing", id: "p2" }] } });
    const file = await screen.findByRole("checkbox", { name: /T0005\.pdf/ });
    expect(file).toBeChecked();
    expect(screen.getByText("1 of 2 pages")).toBeInTheDocument();
    fireEvent.click(file);
    expect(file).not.toBeChecked();
  });

  it("drops a seeded source that is no longer in the project", async () => {
    const { api, requests } = setup([POSTED]);
    open(api, {
      initial: {
        sources: [
          { type: "drawing", id: "gone" },
          { type: "drawing", id: "d1" },
        ],
      },
    });
    expect(await screen.findByRole("checkbox", { name: /ga drawing/i })).toBeChecked();
    expect(await screen.findByText(/1 source is no longer in the project/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /start build/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect((requests.find((r) => r.method === "POST")!.body as { sources: unknown }).sources).toEqual([
      { type: "drawing", id: "d1" },
    ]);
  });

  it("a chosen source that is not ready any more can still be unticked", async () => {
    const { api } = setup();
    open(api, { initial: { sources: [{ type: "drawing", id: "d2" }] } });
    const box = await screen.findByRole("checkbox", { name: /importing/i });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
  });

  it("a no_sources answer takes the named source out and says which", async () => {
    const { api } = setup([
      {
        method: "POST",
        path: /\/runs$/,
        status: 422,
        body: {
          error: {
            code: "no_sources",
            message: "A chosen source is missing or not ready.",
            details: { source: { type: "point_cloud", id: "c1" } },
          },
        },
      },
    ]);
    open(api);
    fireEvent.click(await screen.findByRole("checkbox", { name: /ga drawing/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /may survey cloud/i }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /anthropic/i })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    expect(await screen.findByText(/may survey cloud is missing or not ready/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /may survey cloud/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /ga drawing/i })).toBeChecked();
  });

  it("Try again keeps the run's model name only while its provider is the one chosen", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/providers$/,
        body: { items: [providers.items[0], { ...providers.items[1], has_key: false }, providers.items[2]] },
      },
      { method: "GET", path: /\/data$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
    ] as never);
    open(api, { initial: { provider: "anthropic", model_name: "claude-opus-5-5", notes: "x" } });
    await waitFor(() => expect(screen.getByRole("radio", { name: /gemini/i })).toBeChecked());
    expect(screen.getByLabelText(/^model$/i)).toHaveValue("gemini-2.5-pro");
  });
});
