import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useProjectKindState, useProjectKindStore } from "./useProjectKind";

function Probe() {
  const { kind, failed } = useProjectKindState(PROJECT_ID);
  return <p data-testid="kind">{failed ? "failed" : (kind ?? "loading")}</p>;
}

describe("useProjectKindState", () => {
  beforeEach(() => useProjectKindStore.setState({ byProject: {} }));

  it("retries a failed kind load and recovers once the backend answers", async () => {
    // The first read failed, e.g. the sidecar was not up yet.
    useProjectKindStore.getState().set(PROJECT_ID, "failed");
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: { ...exampleProject, kind: "detect" } },
    ]);
    renderWithProviders(<Probe />, { api });
    expect(screen.getByTestId("kind")).toHaveTextContent("failed");
    await waitFor(() => expect(screen.getByTestId("kind")).toHaveTextContent("detect"), {
      timeout: 4000,
    });
    expect(requests.some((r) => r.url === `/api/v1/projects/${PROJECT_ID}`)).toBe(true);
  });
});
