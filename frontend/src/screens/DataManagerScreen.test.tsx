import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import {
  errorBody,
  exampleImagePage,
  exampleProject,
  fakeClient,
  PROJECT_ID,
  type FakeBody,
  type RecordedRequest,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { DataManagerScreen } from "./DataManagerScreen";

const emptyPage = { items: [], next_cursor: null, total: 0 };
const failure = errorBody("internal_error", "disk full");

function renderScreen(route: string, images: (r: RecordedRequest) => FakeBody = () => exampleImagePage) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    {
      method: "GET",
      path: /\/images$/,
      status: (r) => (images(r) === failure ? 500 : 200),
      body: images,
    },
    { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
  ]);
  renderWithProviders(
    <Routes>
      <Route path="/p/:projectId/images" element={<DataManagerScreen />} />
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

  it("Label next says every image is labeled and points at the dataset builder", async () => {
    // The unlabeled page is empty; any other read lists the project's images.
    renderScreen(`/p/${PROJECT_ID}/images`, (r) =>
      r.url.includes("labeled=false") ? emptyPage : exampleImagePage,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Label next" }));
    expect(
      await screen.findByText("Every image is labeled. Build a dataset from them in Models."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a dataset" })).toHaveAttribute(
      "href",
      `/models/datasets?new=1&project=${PROJECT_ID}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Every image is labeled/)).toBeNull();
  });

  it("Label next says so when the project has no images yet", async () => {
    renderScreen(`/p/${PROJECT_ID}/images`, () => emptyPage);
    fireEvent.click(await screen.findByRole("button", { name: "Label next" }));
    expect(await screen.findByTestId("label-next-notice")).toHaveTextContent("No images to label yet.");
    expect(screen.queryByTestId("editor-route")).toBeNull();
  });

  it("Label next tells the operator when the images cannot be read", async () => {
    renderScreen(`/p/${PROJECT_ID}/images`, (r) =>
      r.url.includes("labeled=false") ? failure : exampleImagePage,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Label next" }));
    expect(await screen.findByTestId("label-next-notice")).toHaveTextContent(
      "Couldn't find the next image to label. Try again.",
    );
    expect(screen.queryByTestId("editor-route")).toBeNull();
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
