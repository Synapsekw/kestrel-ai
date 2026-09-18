import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleImagePage, fakeClient, PROJECT_ID, IMAGE_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useNavigationStore } from "@/store/navigation";
import { ReviewScreen } from "./ReviewScreen";

describe("ReviewScreen", () => {
  beforeEach(() => useNavigationStore.getState().setContext([], null));

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
    expect(screen.getByRole("heading", { name: "Review queue" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["File", "Group", "Pending", "Top confidence", "Boxes"]),
    );
    expect(screen.getByText("2 images waiting")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("image-table"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("editor route")).toBeInTheDocument());
    expect(useNavigationStore.getState().source).toBe("review");
    expect(useNavigationStore.getState().ids[0]).toBe(IMAGE_ID);
  });
});
