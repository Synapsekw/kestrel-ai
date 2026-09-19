import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import { errorBody, exampleDataset, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DatasetsScreen } from "./DatasetsScreen";

const STATS = {
  image_count: 30,
  train_count: 24,
  val_count: 6,
  boxes_per_class: [{ class_id: "c1", class_name: "excavator", train: 20, val: 5 }],
  groups: [],
};

describe("DatasetsScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("lists datasets and opens the detail from the ?dataset= param", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      { method: "GET", path: /\/stats$/, body: STATS },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets?dataset=${exampleDataset.id}`,
      path: "/p/:projectId/datasets",
    });
    expect(await screen.findByRole("heading", { name: "Datasets" })).toBeInTheDocument();
    expect(await screen.findByText("1 dataset")).toBeInTheDocument();
    const table = screen.getByTestId("dataset-table");
    expect(table).toHaveTextContent("v1");
    const detail = await screen.findByTestId("dataset-detail");
    expect(detail).toHaveTextContent("v1");
    await waitFor(() => expect(screen.getByTestId("dataset-class-stats")).toHaveTextContent("excavator"));
  });

  it("counts more than one dataset in the plural (M5c)", async () => {
    const other = { ...exampleDataset, id: "other-dataset", name: "v2" };
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset, other], next_cursor: null } },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    expect(await screen.findByText("2 datasets")).toBeInTheDocument();
  });

  it("selects a dataset by clicking its row", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      { method: "GET", path: /\/stats$/, body: STATS },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    fireEvent.click(await screen.findByText("v1"));
    expect(await screen.findByTestId("dataset-detail")).toBeInTheDocument();
  });

  it("says an unknown ?dataset= id no longer exists, once the list has loaded (M5a)", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets?dataset=not-a-real-id`,
      path: "/p/:projectId/datasets",
    });
    // Not shown while the list is still loading.
    expect(screen.queryByText("That dataset no longer exists.")).not.toBeInTheDocument();
    expect(await screen.findByText("That dataset no longer exists.")).toBeInTheDocument();
    expect(screen.queryByTestId("dataset-detail")).not.toBeInTheDocument();
  });

  it("shows the empty state with links to the Data Manager when there are no datasets", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    expect(await screen.findByText(/No datasets yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((l) => l.getAttribute("href") === `/p/${PROJECT_ID}/data`)).toBe(
      true,
    );
  });

  it("shows the not-available note on 501, with analyst copy (M5d)", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    expect(await screen.findByRole("note")).toHaveTextContent("Datasets are not available.");
  });

  it("opens the new-dataset form", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    fireEvent.click(await screen.findByRole("button", { name: "New dataset from all labeled images" }));
    expect(screen.getByRole("form", { name: "New dataset" })).toBeInTheDocument();
  });

  it("reloads the list once a dataset job finishes (I6)", async () => {
    let calls = 0;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/datasets$/,
        body: () => {
          calls += 1;
          return calls === 1
            ? { items: [], next_cursor: null }
            : { items: [exampleDataset], next_cursor: null };
        },
      },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    await screen.findByText(/No datasets yet/);
    expect(requests.filter((r) => /\/datasets(\?|$)/.test(r.url))).toHaveLength(1);

    const job = { ...runningJob, type: "dataset" as const, state: "running" as const };
    act(() => useJobsStore.getState().upsert(job));
    act(() => useJobsStore.getState().upsert({ ...job, state: "succeeded" }));

    await waitFor(() => expect(screen.getByTestId("dataset-table")).toHaveTextContent("v1"));
    expect(requests.filter((r) => /\/datasets(\?|$)/.test(r.url))).toHaveLength(2);
  });

  it("removes the row at once after a delete, before the reload's GET has even resolved (I6, M5b)", async () => {
    let getCount = 0;
    const gate: { resolve: (() => void) | null } = { resolve: null };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fetchImpl: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input as string | URL, init);
      const url = new URL(req.url);
      if (req.method === "GET" && /\/datasets$/.test(url.pathname)) {
        getCount += 1;
        if (getCount === 1) return json({ items: [exampleDataset], next_cursor: null });
        // The reload's GET is deliberately left hanging: if removal depended on it landing, the
        // row and the detail would still be visible for as long as this stays unresolved.
        await new Promise<void>((resolve) => {
          gate.resolve = () => resolve();
        });
        return json({ items: [exampleDataset], next_cursor: null });
      }
      if (req.method === "GET" && /\/stats$/.test(url.pathname)) return json(STATS);
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      return json(errorBody("not_found", `no fake route for ${req.method} ${url.pathname}`), 404);
    };
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });

    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets?dataset=${exampleDataset.id}`,
      path: "/p/:projectId/datasets",
    });
    await screen.findByTestId("dataset-detail");
    fireEvent.click(screen.getByRole("button", { name: "Delete dataset" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(screen.queryByTestId("dataset-detail")).not.toBeInTheDocument());
    expect(screen.queryByTestId("dataset-table")).not.toBeInTheDocument();
    // ?dataset= was cleared too: if it had not been, "That dataset no longer exists." would show.
    expect(screen.queryByText("That dataset no longer exists.")).not.toBeInTheDocument();
    await waitFor(() => expect(getCount).toBe(2)); // the reload did start...
    expect(screen.queryByTestId("dataset-table")).not.toBeInTheDocument(); // ...but has not landed yet

    gate.resolve?.();
  });
});
