import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ApiClient } from "@contract/client";
import { messageOf } from "@/api/errors";
import { errorBody, exampleProject, exampleSource, runningJob, type FakeRoute } from "@/test/fixtures";
import { LocationProbe, TestApiProvider } from "@/test/render";
import { bucket, draft, draftType, heldClient } from "@/test/setupDispatchFixtures";
import { slotImports, useSetupImports } from "./dispatch";
import { useSetupDraft, type SetupDraft } from "./draftStore";
import { useCreateProject } from "./useCreateProject";

const P = exampleProject.id;
const D = draft({
  types: [draftType("Corrosion", "1")],
  buckets: [bucket({ route: "images", slot_key: "visual" })],
});
const ENSURE: FakeRoute = {
  method: "POST",
  path: /\/catalogue\/types\/ensure$/,
  body: { items: [{ name: "Corrosion", id: "t1", created: true, conflict: null }] },
};
const SOURCES: FakeRoute = {
  method: "POST",
  path: /\/sources$/,
  status: 202,
  body: { source: exampleSource, job: runningJob },
};

function Harness({ d }: { d: SetupDraft }) {
  const create = useCreateProject();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void create(d).catch((e: unknown) => setError(messageOf(e, "could not create the project")))
        }
      >
        Create project
      </button>
      {error && <p role="alert">{error}</p>}
      <LocationProbe />
    </>
  );
}

function mount(api: ApiClient) {
  render(
    <TestApiProvider api={api}>
      <MemoryRouter initialEntries={["/projects/new"]}>
        <Routes>
          <Route path="*" element={<Harness d={D} />} />
        </Routes>
      </MemoryRouter>
    </TestApiProvider>,
  );
}

const realDiscard = useSetupDraft.getState().discard;
const discard = vi.fn();
const states = () => slotImports(useSetupImports.getState().byProject[P]).map((s) => s.state);

beforeEach(() => {
  discard.mockReset();
  useSetupDraft.setState({ discard });
  useSetupImports.setState({ byProject: {} });
});
afterEach(() => useSetupDraft.setState({ discard: realDiscard }));

describe("useCreateProject", () => {
  it("opens the new project's Overview before its imports have started, and clears the draft", async () => {
    const { api, release } = heldClient(
      [ENSURE, { method: "POST", path: /\/projects$/, status: 201, body: exampleProject }, SOURCES],
      /\/sources$/,
    );
    mount(api);
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${P}/overview`));
    expect(discard).toHaveBeenCalledTimes(1);
    expect(states()).toEqual(["pending"]);
    release();
    await waitFor(() => expect(states()).toEqual(["started"]));
  });

  it("stays on the page with the draft when the project cannot be created", async () => {
    const { api } = heldClient(
      [
        ENSURE,
        {
          method: "POST",
          path: /\/projects$/,
          status: 409,
          body: errorBody("project_exists", "this folder already holds a project"),
        },
      ],
      /^$/,
    );
    mount(api);
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("this folder already holds a project");
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/new");
    expect(discard).not.toHaveBeenCalled();
  });
});
