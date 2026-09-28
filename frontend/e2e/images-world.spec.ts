import { test, expect } from "@playwright/test";
import { djiFrames, P, serveImages } from "./images/world";
import { openImage, ws } from "./images/ui";

test("the Images world serves the workspace: the first DJI frame opens at its stored size", async ({
  page,
}) => {
  const frames = djiFrames();
  await serveImages(page, { frames });
  await openImage(page, P, frames[0].id, "800x600");
  await expect(ws(page).statusBar).toContainText(/Image\s+1\s*\/\s*3/);
});
