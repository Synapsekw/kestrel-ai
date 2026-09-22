import { useState } from "react";
import { useLocation } from "react-router-dom";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConversation, AgentItem, AgentTurn } from "@contract/client";
import { AgentDrawer } from "@/agent/AgentDrawer";
import { useJobsStore } from "@/store/jobs";
import { exampleProviders, fakeClient, PROJECT_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useProjectAgentEvents } from "./agentEvents";
import { screenRoute } from "./useProjectAgent";

const turn = (state: AgentTurn["state"], extra: Partial<AgentTurn> = {}): AgentTurn => ({
  id: "turn-1",
  state,
  provider: "anthropic",
  model_name: "claude-opus-5",
  error: null,
  tool_calls: 1,
  created_at: "2026-09-22T10:00:00Z",
  finished_at: null,
  ...extra,
});

let seq = 0;
function item(kind: AgentItem["kind"], extra: Partial<AgentItem> = {}): AgentItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    seq,
    turn_id: "turn-1",
    kind,
    text: "",
    tool_name: null,
    tool_input: null,
    tool_status: null,
    tool_summary: null,
    job_ids: [],
    approval: null,
    navigate: null,
    created_at: "2026-09-22T10:00:00Z",
    ...extra,
  };
}

function routes(conv: () => AgentConversation, providers = exampleProviders): FakeRoute[] {
  return [
    { method: "GET", path: /\/providers$/, body: { items: providers } },
    { method: "GET", path: /\/agent$/, body: () => conv() },
    { method: "POST", path: /\/agent\/turns$/, status: 202, body: turn("running") },
    { method: "POST", path: /\/cancel$/, body: turn("cancelled") },
    { method: "POST", path: /\/approval$/, body: turn("running") },
    { method: "DELETE", path: /\/agent$/, status: 204 },
    { method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob },
    { method: "GET", path: /\/starter-models$/, body: { items: [] } },
  ];
}

function Where() {
  return <output aria-label="Current location">{useLocation().pathname}</output>;
}

function renderDrawer(conv: () => AgentConversation, opts: { providers?: typeof exampleProviders } = {}) {
  const fake = fakeClient(routes(conv, opts.providers));
  const utils = renderWithProviders(
    <>
      <Where />
      <AgentDrawer projectId={PROJECT_ID} projectName="Ahmadia" open onClose={() => {}} />
    </>,
    { api: fake.api, route: `/p/${PROJECT_ID}/data`, path: "/p/:projectId/*" },
  );
  return { ...fake, ...utils };
}

const posts = (requests: { method: string; url: string }[], suffix: string) =>
  requests.filter((r) => r.method === "POST" && r.url.endsWith(suffix));

beforeEach(() => {
  seq = 0;
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable */
  }
  useJobsStore.setState({ jobs: {} });
  useProjectAgentEvents.setState({ revision: {} });
});
afterEach(() => {
  useJobsStore.setState({ jobs: {} });
});

describe("AgentDrawer", () => {
  it("shows the Setup agent outside a project", async () => {
    const { api } = fakeClient(routes(() => ({ items: [], turn: null })));
    renderWithProviders(<AgentDrawer projectId={undefined} projectName={null} open onClose={() => {}} />, {
      api,
    });
    expect(await screen.findByRole("dialog", { name: "Setup agent" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Project agent" })).not.toBeInTheDocument();
  });

  it("shows the Project agent inside a project", async () => {
    renderDrawer(() => ({ items: [], turn: null }));
    const dialog = await screen.findByRole("dialog", { name: "Project agent" });
    expect(within(dialog).getByText("Ahmadia")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Setup agent" })).not.toBeInTheDocument();
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it("keeps the Setup agent open when its flow moves into the new project", async () => {
    const { api } = fakeClient(routes(() => ({ items: [], turn: null })));
    function Harness() {
      const [pid, setPid] = useState<string | undefined>(undefined);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setPid(PROJECT_ID)}>Enter project</button>
          <button onClick={() => setOpen((o) => !o)}>Toggle</button>
          <AgentDrawer projectId={pid} projectName="Ahmadia" open={open} onClose={() => setOpen(false)} />
        </>
      );
    }
    renderWithProviders(<Harness />, { api });
    await screen.findByRole("dialog", { name: "Setup agent" });
    fireEvent.click(screen.getByRole("button", { name: "Enter project" }));
    expect(screen.getByRole("dialog", { name: "Setup agent" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Project agent" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(await screen.findByRole("dialog", { name: "Project agent" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Setup agent" })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    let closed = 0;
    const { api } = fakeClient(routes(() => ({ items: [], turn: null })));
    renderWithProviders(
      <AgentDrawer projectId={PROJECT_ID} projectName="Ahmadia" open onClose={() => (closed += 1)} />,
      { api },
    );
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "Project agent" }), { key: "Escape" });
    expect(closed).toBe(1);
  });
});

describe("ProjectAgent", () => {
  it("renders user, assistant and tool items and hides empty assistant text", async () => {
    const items = [
      item("user", { text: "Label the first 500 images" }),
      item("assistant", { text: "" }),
      item("tool", {
        tool_name: "find_images",
        tool_status: "ok",
        tool_summary: "Found 500 images",
        tool_input: { limit: 500 },
      }),
      item("tool", { tool_name: "label_images", tool_status: "running" }),
      item("assistant", { text: "Labeling started." }),
    ];
    renderDrawer(() => ({ items, turn: turn("succeeded") }));
    const log = await screen.findByRole("log");
    expect(await within(log).findByText("Label the first 500 images")).toBeInTheDocument();
    expect(within(log).getByText("Labeling started.")).toBeInTheDocument();
    expect(within(log).getByText("Found 500 images")).toBeInTheDocument();
    expect(within(log).getByText("Done")).toBeInTheDocument();
    expect(within(log).getByText("Label images")).toBeInTheDocument();
    expect(within(log).getByText("Running")).toBeInTheDocument();
    // one assistant heading only: the empty assistant item is hidden
    expect(within(log).getAllByText("Project agent")).toHaveLength(1);
    fireEvent.click(within(log).getAllByRole("button", { name: /details/i })[0]);
    expect(within(log).getByText(/"limit": 500/)).toBeInTheDocument();
  });

  it("shows live progress for a job the tool started", async () => {
    useJobsStore.getState().upsert({ ...runningJob, progress: 0.4 });
    const items = [
      item("tool", {
        tool_name: "label_images",
        tool_status: "ok",
        tool_summary: "Started labeling",
        job_ids: [runningJob.id],
      }),
    ];
    renderDrawer(() => ({ items, turn: turn("succeeded") }));
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("approves and denies the pending action", async () => {
    const items = [
      item("tool", {
        tool_name: "train_model",
        tool_status: "awaiting_approval",
        approval: { title: "Train yolo11n", detail: "30 epochs", estimated_cost: 1.5 },
      }),
    ];
    const { requests } = renderDrawer(() => ({ items, turn: turn("awaiting_approval") }));
    const card = await screen.findByRole("group", { name: "Approval needed" });
    expect(within(card).getByText("Train yolo11n")).toBeInTheDocument();
    expect(within(card).getByText("30 epochs")).toBeInTheDocument();
    expect(within(card).getByText("≈ $1.50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(requests, "/approval")).toHaveLength(1));
    expect(posts(requests, "/approval")[0]).toMatchObject({ body: { approve: true } });
  });

  it("denies the pending action", async () => {
    const items = [
      item("tool", {
        tool_name: "delete_images",
        tool_status: "awaiting_approval",
        approval: { title: "Delete 3 images", detail: "Cannot be undone", estimated_cost: null },
      }),
    ];
    const { requests } = renderDrawer(() => ({ items, turn: turn("awaiting_approval") }));
    const card = await screen.findByRole("group", { name: "Approval needed" });
    expect(within(card).queryByText(/≈ \$/)).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(posts(requests, "/approval")).toHaveLength(1));
    expect(posts(requests, "/approval")[0]).toMatchObject({ body: { approve: false } });
  });

  it("sends with Enter and clears the composer", async () => {
    const { requests } = renderDrawer(() => ({ items: [], turn: null }));
    const box = await screen.findByLabelText("Message");
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("anthropic"));
    fireEvent.change(box, { target: { value: "How many images?" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(posts(requests, "/agent/turns")).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(posts(requests, "/agent/turns")).toHaveLength(1));
    expect(posts(requests, "/agent/turns")[0]).toMatchObject({
      body: { provider: "anthropic", message: "How many images?" },
    });
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("fills the composer from an example and sends with the button", async () => {
    const { requests } = renderDrawer(() => ({ items: [], turn: null }));
    fireEvent.click(
      await screen.findByRole("button", { name: "How many images still have unreviewed suggestions?" }),
    );
    expect(screen.getByLabelText("Message")).toHaveValue(
      "How many images still have unreviewed suggestions?",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(posts(requests, "/agent/turns")).toHaveLength(1));
  });

  it("stops a running turn, and Clear is disabled while it runs", async () => {
    const items = [item("user", { text: "Go" })];
    const { requests } = renderDrawer(() => ({ items, turn: turn("running") }));
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(screen.getByRole("button", { name: "Clear conversation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.click(stop);
    await waitFor(() => expect(posts(requests, "/turns/turn-1/cancel")).toHaveLength(1));
  });

  it("offers Stop while a card waits, so a turn nobody can resolve is never a dead end", async () => {
    const items = [
      item("tool", {
        tool_name: "delete_images",
        tool_status: "awaiting_approval",
        approval: { title: "Delete 3 images", detail: "Cannot be undone", estimated_cost: null },
      }),
    ];
    const { requests } = renderDrawer(() => ({ items, turn: turn("awaiting_approval") }));
    const stop = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stop);
    await waitFor(() => expect(posts(requests, "/turns/turn-1/cancel")).toHaveLength(1));
  });

  it("says Finished. when a succeeded turn ends on an empty answer", async () => {
    const items = [item("user", { text: "Go" }), item("assistant", { text: "" })];
    renderDrawer(() => ({ items, turn: turn("succeeded") }));
    const log = await screen.findByRole("log");
    expect(await within(log).findByText("Finished.")).toBeInTheDocument();
  });

  it("does not say Finished. while the turn is still running", async () => {
    const items = [item("user", { text: "Go" }), item("assistant", { text: "" })];
    renderDrawer(() => ({ items, turn: turn("running") }));
    const log = await screen.findByRole("log");
    await within(log).findByText("Go");
    expect(within(log).queryByText("Finished.")).not.toBeInTheDocument();
  });

  it("clears the conversation when idle", async () => {
    const items = [item("user", { text: "Go" })];
    const { requests } = renderDrawer(() => ({ items, turn: turn("succeeded") }));
    await screen.findByText("Go");
    const clear = screen.getByRole("button", { name: "Clear conversation" });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
  });

  it("explains a missing key and links to App settings", async () => {
    const noKeys = exampleProviders.map((p) => ({ ...p, has_key: false }));
    renderDrawer(() => ({ items: [], turn: null }), { providers: noKeys });
    const link = await screen.findByRole("link", { name: "App settings" });
    expect(link).toHaveAttribute("href", "/settings");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("shows the error of a failed turn", async () => {
    const items = [item("user", { text: "Go" })];
    renderDrawer(() => ({
      items,
      turn: turn("failed", { error: "The provider could not complete this step. Try again." }),
    }));
    expect(
      await screen.findByText("The provider could not complete this step. Try again."),
    ).toBeInTheDocument();
  });

  it("remembers the provider choice", async () => {
    const both = exampleProviders.map((p) => ({ ...p, has_key: true }));
    const first = renderDrawer(() => ({ items: [], turn: null }), { providers: both });
    const select = await screen.findByLabelText("Provider");
    await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(2));
    fireEvent.change(select, { target: { value: "openai" } });
    expect(localStorage.getItem("kestrel.agent.provider")).toBe("openai");
    first.unmount();
    renderDrawer(() => ({ items: [], turn: null }), { providers: both });
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("openai"));
  });

  it("navigates for open_screen items that arrive live, not for history", async () => {
    const items: AgentItem[] = [
      item("tool", {
        tool_name: "open_screen",
        tool_status: "ok",
        navigate: { screen: "datasets", image_id: null },
      }),
    ];
    const { requests } = renderDrawer(() => ({ items, turn: turn("running") }));
    await screen.findByText("Done");
    expect(requests.filter((r) => r.method === "GET" && r.url.endsWith("/agent"))).toHaveLength(1);
    expect(screen.getByLabelText("Current location")).toHaveTextContent(`/p/${PROJECT_ID}/data`);

    items.push(
      item("tool", {
        tool_name: "open_screen",
        tool_status: "ok",
        navigate: { screen: "editor", image_id: "img-9" },
      }),
    );
    act(() => useProjectAgentEvents.getState().bump(PROJECT_ID));
    await waitFor(() =>
      expect(screen.getByLabelText("Current location")).toHaveTextContent(`/p/${PROJECT_ID}/edit/img-9`),
    );
  });

  it("refetches on an agent event for this project only", async () => {
    const { requests } = renderDrawer(() => ({ items: [], turn: null }));
    const gets = () => requests.filter((r) => r.method === "GET" && r.url.endsWith("/agent")).length;
    await waitFor(() => expect(gets()).toBe(1));
    act(() => useProjectAgentEvents.getState().bump("other-project"));
    act(() => {
      useProjectAgentEvents.getState().bump(PROJECT_ID);
      useProjectAgentEvents.getState().bump(PROJECT_ID);
    });
    await waitFor(() => expect(gets()).toBe(2));
    await new Promise((r) => setTimeout(r, 250));
    expect(gets()).toBe(2);
  });
});

describe("screenRoute", () => {
  it("encodes the image id of an editor route", () => {
    expect(screenRoute("p1", { screen: "editor", image_id: "a/b?c" })).toBe("/p/p1/edit/a%2Fb%3Fc");
    expect(screenRoute("p1", { screen: "editor", image_id: null })).toBeNull();
    expect(screenRoute("p1", { screen: "detect", image_id: null })).toBe("/p/p1/query");
  });
});
