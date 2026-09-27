import { useEffect, useMemo, useState } from "react";
import { ApiContext } from "@/api/client";
import { ToolPalette } from "@/images/tools/ToolPalette";
import { ZoomCluster } from "@/images/tools/ZoomCluster";
import { statusHintsFor, useHeldKeys, useImagesKeymap } from "@/images/workspace/keymap";
import { saveState, useImagesWorkspace } from "@/store/imagesWorkspace";
import { Toaster } from "@/ui";
import { useCommandContext } from "../commands";
import { ImageCanvas } from "../ImageCanvas";
import { useCanvasKeyHandlers } from "../useCanvasKeys";
import { useImageData } from "../useImageData";
import { createLabApi, LAB_IMAGE_ID, LAB_PROJECT_ID, LAB_TYPES, seedFindingLinks } from "./labApi";
import { makeLabFrame } from "./labFrame";

function LabWorkspace({ frame, shapes }: { frame: string; shapes: number }) {
  const { loading, error } = useImageData(LAB_PROJECT_ID, LAB_IMAGE_ID);
  // FW links the image's findings from GET /findings?image_id=; the lab links its seeded ones.
  useEffect(() => {
    if (!loading) useImagesWorkspace.getState().linkFindings(seedFindingLinks(shapes));
  }, [loading, shapes]);
  const ctx = useCommandContext(LAB_PROJECT_ID);
  const canvasKeys = useCanvasKeyHandlers(ctx);
  useImagesKeymap([canvasKeys]);
  useHeldKeys();
  const tool = useImagesWorkspace((s) => s.tool);
  const save = useImagesWorkspace(saveState);
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-ink">
      <ImageCanvas
        projectId={LAB_PROJECT_ID}
        types={LAB_TYPES}
        imageUrl={() => frame}
        className="min-h-0 flex-1 rounded-panel"
      >
        <ToolPalette ctx={ctx} className="absolute left-3 top-3" />
        <ZoomCluster className="absolute right-3 top-3" />
      </ImageCanvas>
      <footer className="flex h-[30px] shrink-0 items-center justify-between font-mono text-2xs text-muted">
        <span>{error ?? statusHintsFor(tool)}</span>
        <span>{save === "saving" ? "◌ Saving…" : save === "failed" ? "▲ Save failed" : "● Saved"}</span>
      </footer>
      <Toaster />
    </div>
  );
}

/** Dev-only harness for ImageCanvas without the route (ruling FC-R12). */
export function CanvasLab() {
  const shapes = Number(new URLSearchParams(window.location.search).get("shapes") ?? "12");
  const lab = useMemo(
    () => createLabApi({ shapes: Number.isFinite(shapes) ? shapes : 12, types: LAB_TYPES }),
    [shapes],
  );
  const [frame, setFrame] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    void makeLabFrame().then((u) => {
      url = u;
      if (live) setFrame(u);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);
  if (!frame) return <p className="p-6 text-muted">Drawing the test frame…</p>;
  return (
    <ApiContext.Provider
      value={{
        client: lab.api,
        info: { baseUrl: "http://fake", token: "lab", mode: "mock", logPath: null },
        health: {} as never,
      }}
    >
      <LabWorkspace frame={frame} shapes={Number.isFinite(shapes) ? shapes : 12} />
    </ApiContext.Provider>
  );
}
