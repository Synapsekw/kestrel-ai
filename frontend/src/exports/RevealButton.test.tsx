import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { RevealButton } from "./RevealButton";

describe("RevealButton", () => {
  it("posts the given path to reveal", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/reveal$/, status: 204 }]);
    renderWithProviders(<RevealButton projectId={PROJECT_ID} path="models/x.onnx" />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    await screen.findByRole("button", { name: "Show in folder" });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/reveal`,
      body: { path: "models/x.onnx" },
    });
  });

  it("shows the backend message on failure", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/reveal$/,
        status: 404,
        body: { error: { code: "not_found", message: "path not found", details: {} } },
      },
    ]);
    renderWithProviders(<RevealButton projectId={PROJECT_ID} path="models/x.onnx" />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("path not found");
  });
});
