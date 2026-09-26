import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { exampleImagePage, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { DataManagerScreen } from "./DataManagerScreen";

function Search() {
  return <p data-testid="search">{useLocation().search}</p>;
}

function renderScreen(route: string) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/images$/, body: exampleImagePage },
    { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
  ]);
  renderWithProviders(
    <Routes>
      <Route
        path="/p/:projectId/images"
        element={
          <>
            <DataManagerScreen />
            <Search />
          </>
        }
      />
      <Route path="/p/:projectId/images/:imageId" element={<p data-testid="editor-route" />} />
    </Routes>,
    { api, route },
  );
  return requests;
}

describe("DataManagerScreen", () => {
  beforeEach(() => {
    useChangesStore.setState({ imagesRevision: 0, boxesRevision: {} });
  });

  it("is titled Images and lists the shortcuts behind the keyboard button", async () => {
    renderScreen(`/p/${PROJECT_ID}/images`);
    expect(screen.getByRole("heading", { name: "Images" })).toBeInTheDocument();
    await screen.findByRole("list", { name: "Images" });
    expect(screen.queryByText(/Every image is labeled/)).toBeNull();

    const keys = screen.getByRole("button", { name: "Keyboard shortcuts" });
    expect(keys).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(keys);
    const legend = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(legend).toHaveTextContent("Select all listed images");
    expect(legend).toHaveTextContent("Ctrl+A");
    expect(legend).toHaveTextContent("J/KNext or previous image");
    fireEvent.keyDown(legend, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("says every image is labeled when sent with ?notice=all-labeled, then drops the parameter", async () => {
    renderScreen(`/p/${PROJECT_ID}/images?notice=all-labeled`);
    expect(
      screen.getByText("Every image is labeled. Build a dataset from them in Models."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a dataset" })).toHaveAttribute(
      "href",
      `/models/datasets?new=1&project=${PROJECT_ID}`,
    );
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
    // Read once: dropping the parameter does not take the notice away.
    expect(
      screen.getByText("Every image is labeled. Build a dataset from them in Models."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Every image is labeled/)).toBeNull();
  });

  it("lists only unlabeled images when opened with ?filter=unlabeled", async () => {
    const requests = renderScreen(`/p/${PROJECT_ID}/images?filter=unlabeled`);
    await screen.findByRole("list", { name: "Images" });
    const url = new URL(`http://x${requests.find((r) => r.url.includes("/images?"))!.url}`);
    expect(url.searchParams.get("labeled")).toBe("false");
  });

  it("Label next opens the first unlabeled image", async () => {
    renderScreen(`/p/${PROJECT_ID}/images`);
    fireEvent.click(await screen.findByRole("button", { name: "Label next" }));
    expect(await screen.findByTestId("editor-route")).toBeInTheDocument();
  });
});
