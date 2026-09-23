import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleImagePage, fakeClient, PROJECT_ID, IMAGE_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useNavigationStore } from "@/store/navigation";
import { useProjectKindStore } from "@/app/useProjectKind";
import { ReviewScreen } from "./ReviewScreen";

describe("ReviewScreen", () => {
  beforeEach(() => {
    useNavigationStore.getState().setContext([], null);
    useProjectKindStore.setState({ byProject: {} });
  });

  it("in a training project, suggestions come from pre-annotation, not from a Detect screen", async () => {
    useProjectKindStore.getState().set(PROJECT_ID, "train");
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/p/:projectId/review" element={<ReviewScreen />} />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/review` },
    );
    const empty = await screen.findByTestId("review-empty");
    expect(empty).toHaveTextContent("Suggestions appear here when the editor opens an image");
    expect(screen.queryByRole("link", { name: "Detect screen" })).toBeNull();
  });

  it("requests the review queue query, shows confidence and opens the editor with a review context", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/images$/, body: exampleImagePage },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/p/:projectId/review" element={<ReviewScreen />} />
        <Route path="/p/:projectId/edit/:imageId" element={<p>editor route</p>} />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/review` },
    );
    await waitFor(() => expect(screen.getByText("81%")).toBeInTheDocument());
    const url = new URL(`http://x${requests.find((r) => r.url.includes("/images?"))?.url}`);
    expect(url.searchParams.get("has_pending")).toBe("true");
    expect(url.searchParams.get("sort")).toBe("max_pending_confidence");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["File", "Group", "Pending", "Top confidence", "Boxes"]),
    );
    expect(screen.getByText("2 images waiting")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("image-table"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("editor route")).toBeInTheDocument());
    expect(useNavigationStore.getState().source).toBe("review");
    expect(useNavigationStore.getState().ids[0]).toBe(IMAGE_ID);
  });

  it("explains an empty queue and where suggestions come from", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/p/:projectId/review" element={<ReviewScreen />} />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/review` },
    );
    const empty = await screen.findByTestId("review-empty");
    expect(empty).toHaveTextContent("Nothing to review");
    expect(empty).toHaveTextContent("Suggestions appear here after a detection run on the Detect screen");
    expect(screen.getByRole("link", { name: "Detect screen" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/query`,
    );
    expect(screen.getByRole("link", { name: "Project settings" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/settings`,
    );
  });

  it("counts the images of a run that still wait, not the ids in the link", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, body: exampleImagePage },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/p/:projectId/review" element={<ReviewScreen />} />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/review?ids=a,b,c,d,e` },
    );
    await waitFor(() =>
      expect(screen.getByTestId("run-filter")).toHaveTextContent(
        "2 of the 5 images of this detection run still have suggestions to review.",
      ),
    );
  });
});
