import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { KindRoute } from "./KindRoute";
import { useProjectKindStore } from "./useProjectKind";

function renderAt(route: string, kind: "train" | "detect" | null, status = 200) {
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/projects\/[^/]+$/,
      status,
      body: status === 200 ? { ...exampleProject, kind: kind ?? "train" } : { error: {} },
    },
  ]);
  renderWithProviders(
    <Routes>
      <Route path="p/:projectId" element={<p>home screen</p>} />
      <Route
        path="p/:projectId/datasets"
        element={
          <KindRoute allow={["train"]}>
            <p>datasets screen</p>
          </KindRoute>
        }
      />
    </Routes>,
    { api, route },
  );
  return requests;
}

describe("KindRoute", () => {
  beforeEach(() => useProjectKindStore.setState({ byProject: {} }));

  it("sends a detection project's datasets route to the project home", async () => {
    renderAt(`/p/${PROJECT_ID}/datasets`, "detect");
    expect(await screen.findByText("home screen")).toBeInTheDocument();
    expect(screen.queryByText("datasets screen")).toBeNull();
  });

  it("renders the screen for a project of an allowed kind", async () => {
    renderAt(`/p/${PROJECT_ID}/datasets`, "train");
    expect(await screen.findByText("datasets screen")).toBeInTheDocument();
  });

  it("uses a kind already known without asking the backend again", async () => {
    useProjectKindStore.getState().set(PROJECT_ID, "train");
    const requests = renderAt(`/p/${PROJECT_ID}/datasets`, "train");
    expect(screen.getByText("datasets screen")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("shows the screen when the kind cannot be loaded: the backend still guards it", async () => {
    renderAt(`/p/${PROJECT_ID}/datasets`, null, 500);
    expect(await screen.findByText("datasets screen")).toBeInTheDocument();
  });
});
