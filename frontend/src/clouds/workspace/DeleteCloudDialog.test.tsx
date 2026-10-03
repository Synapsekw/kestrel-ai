import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@contract/client";
import { exampleCloud, CLOUD_ID } from "@/test/cloudFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { DeleteCloudDialog } from "./DeleteCloudDialog";

const HAS_FINDINGS = {
  error: { code: "cloud_has_findings", message: "Chimney stack 3D has 3 findings", details: { count: 3 } },
};

function open(routes: Parameters<typeof fakeClient>[0]) {
  const { api, requests } = fakeClient(routes);
  const onDeleted = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <DeleteCloudDialog
      open
      projectId={PROJECT_ID}
      cloud={exampleCloud}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
    { api },
  );
  return { requests, onDeleted, onClose };
}

describe("DeleteCloudDialog (spec C14)", () => {
  it("deletes a cloud without findings in one step", async () => {
    const { requests, onDeleted } = open([
      { method: "DELETE", path: new RegExp(`/pointclouds/${CLOUD_ID}$`), status: 204 },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(requests.map((r) => r.url)).toEqual([`/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD_ID}`]);
  });

  it("asks again when the cloud has findings, and only then sends delete_findings=true", async () => {
    const before = useChangesStore.getState().findingsRevision;
    const { requests, onDeleted } = open([
      {
        method: "DELETE",
        path: new RegExp(`/pointclouds/${CLOUD_ID}$`),
        status: (r) => (r.url.includes("delete_findings=true") ? 204 : 409),
        body: (r) => (r.url.includes("delete_findings=true") ? null : HAS_FINDINGS),
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(
      await screen.findByRole("dialog", { name: "Delete the cloud and its 3 findings?" }),
    ).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete cloud and 3 findings" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(requests.map((r) => r.url)).toEqual([
      `/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD_ID}`,
      `/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD_ID}?delete_findings=true`,
    ]);
    // The findings were deleted server-side with the cloud: the findings list must re-read.
    expect(useChangesStore.getState().findingsRevision).toBe(before + 1);
  });

  it("keeps any other refusal in the dialog and deletes nothing", async () => {
    const { onDeleted } = open([
      {
        method: "DELETE",
        path: new RegExp(`/pointclouds/${CLOUD_ID}$`),
        status: 409,
        body: { error: { code: "job_running", message: "an export of this cloud is running", details: {} } },
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("an export of this cloud is running")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Are you sure?" })).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("disables Cancel while the delete is in flight", async () => {
    const hung = new Promise<Response>(() => {});
    const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.method === "DELETE") return hung;
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    renderWithProviders(
      <DeleteCloudDialog
        open
        projectId={PROJECT_ID}
        cloud={exampleCloud}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
      { api },
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
  });
});
