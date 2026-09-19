import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation, useParams } from "react-router-dom";
import { exampleImage, exampleImage2, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useNavigationStore } from "@/store/navigation";
import { LabelResolverScreen } from "./LabelResolverScreen";

function Editor() {
  const { imageId } = useParams();
  return <p>editor {imageId}</p>;
}
function Data() {
  const { search } = useLocation();
  return <p>data {search}</p>;
}

function renderResolver(routes: Parameters<typeof fakeClient>[0]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(
    <Routes>
      <Route path="/p/:projectId/label" element={<LabelResolverScreen />} />
      <Route path="/p/:projectId/edit/:imageId" element={<Editor />} />
      <Route path="/p/:projectId/data" element={<Data />} />
    </Routes>,
    { api, route: `/p/${PROJECT_ID}/label` },
  );
  return requests;
}

describe("LabelResolverScreen", () => {
  it("opens the first unlabeled image and hands the unlabeled list to the editor", async () => {
    const requests = renderResolver([
      {
        method: "GET",
        path: /\/images$/,
        body: { items: [exampleImage, exampleImage2], next_cursor: null, total: 2 },
      },
    ]);
    expect(await screen.findByText(`editor ${exampleImage.id}`)).toBeInTheDocument();
    expect(requests[0].url).toContain("labeled=false");
    expect(useNavigationStore.getState().ids).toEqual([exampleImage.id, exampleImage2.id]);
    expect(useNavigationStore.getState().returnTo).toBe(`/p/${PROJECT_ID}/data`);
  });

  it("goes to Images with a notice when every image is labeled", async () => {
    let calls = 0;
    renderResolver([
      {
        method: "GET",
        path: /\/images$/,
        body: () => {
          calls += 1;
          return calls === 1
            ? { items: [], next_cursor: null, total: 0 }
            : { items: [exampleImage], next_cursor: null, total: 1 };
        },
      },
    ]);
    expect(await screen.findByText("data ?notice=all-labeled")).toBeInTheDocument();
  });

  it("goes to Images plainly when the project has no images", async () => {
    renderResolver([{ method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } }]);
    await waitFor(() => expect(screen.getByText(/^data/)).toHaveTextContent("data"));
    expect(screen.getByText(/^data/)).not.toHaveTextContent("notice");
  });
});
