import { describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleImagePage, fakeClient, IMAGE_ID, IMAGE_ID_2, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useNavigationStore } from "@/store/navigation";
import { ReviewScreen } from "./ReviewScreen";

describe("ReviewScreen with ?ids=", () => {
  it("asks for exactly those images and offers the whole queue", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/images$/, body: exampleImagePage },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<ReviewScreen />, {
      api,
      route: `/p/${PROJECT_ID}/review?ids=${IMAGE_ID},${IMAGE_ID_2}`,
      path: "/p/:projectId/review",
    });
    await waitFor(() => expect(requests.some((r) => r.url.includes("/images?"))).toBe(true));
    const url = new URL(`http://x${requests.find((r) => r.url.includes("/images?"))?.url}`);
    expect(url.searchParams.get("ids")).toBe(`${IMAGE_ID},${IMAGE_ID_2}`);
    expect(url.searchParams.get("has_pending")).toBe("true");
    expect(
      await screen.findByText(/of the 2 images of this detection run still have proposals/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show the whole queue" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/review`,
    );
    // Opening an image remembers this filtered queue, so the editor can lead back to it.
    await screen.findByText("81%");
    fireEvent.keyDown(screen.getByTestId("image-table"), { key: "Enter" });
    expect(useNavigationStore.getState().returnTo).toBe(
      `/p/${PROJECT_ID}/review?ids=${IMAGE_ID},${IMAGE_ID_2}`,
    );
  });
});
