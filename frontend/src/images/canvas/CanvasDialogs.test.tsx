import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { CanvasDialogs } from "./CanvasDialogs";
import { makeDetail, makeShape } from "./testing";
import type { CommandContext } from "./commands";

const st = () => useImagesWorkspace.getState();

beforeEach(() => {
  st().reset();
  st().loadImage(makeDetail(), [makeShape({ id: "b" })], []);
  st().linkFindings({ b: "f1" });
});

describe("CanvasDialogs", () => {
  it("names the findings with content and deletes on confirm", async () => {
    const { api } = fakeClient([{ method: "DELETE", path: /\/boxes\/b$/, status: 204, body: null }]);
    const ctx: CommandContext = {
      api,
      projectId: PROJECT_ID,
      store: useImagesWorkspace,
      history: st().history,
    };
    st().setConfirm({ kind: "delete", ids: ["b"], findings: [{ id: "f1", number: 217 } as never] });
    render(<CanvasDialogs ctx={ctx} />);
    expect(screen.getByText(/F-0217 has a note, photos or comments/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(st().boxes.b).toBeUndefined());
  });

  it("keeps everything on Keep", async () => {
    const ctx: CommandContext = {
      api: fakeClient([]).api,
      projectId: PROJECT_ID,
      store: useImagesWorkspace,
      history: st().history,
    };
    st().setConfirm({ kind: "retype", ids: ["b"], typeId: "truck" });
    render(<CanvasDialogs ctx={ctx} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep the finding" }));
    expect(st().confirm).toBeNull();
    expect(st().boxes.b.class_id).not.toBe("truck");
  });
});
