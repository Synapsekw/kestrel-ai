// The point-cloud workspace's controls for the CDP drivers (C-G ruling G3). Keep in step with
// frontend/e2e/fixtures/cloudWorkspace.ts by hand: the e2e specs and these drivers must name the same
// elements. Names below were checked against the merged code (same audit as that fixture's Task 1
// Step 5); where the spec's draft name differed from the real one, the real one is used here too:
//   - palette toolbar: "Point cloud tools" (not "Tools")
//   - hint bar test id: "cloud-hintbar" (not "cloud-hint-bar")
//   - the callout's Type control is a button named "Type: <label>" (PinCallout.tsx's Combobox
//     trigger aria-label), not a role="combobox" named "Type" — that role only exists on the open
//     popover's filter input, which isn't present until the trigger is clicked.

/** The Findings-tab menu button that holds "Capture missing views" (C-R1, Inspector.tsx). */
export const CAPTURE_MENU = "Findings actions";

export function ui(page) {
  const palette = page.getByRole("toolbar", { name: "Point cloud tools" });
  const tabs = page.getByRole("tablist", { name: "Inspector" });
  const hint = page.getByTestId("cloud-hintbar");
  const callout = page.getByTestId("cloud-callout");
  return {
    viewport: page.getByTestId("cloud-centre"),
    canvas: page.getByTestId("cloud-canvas"),
    // Readout.tsx "cloud-readout" (spec: "pick-readout"); SiteMinimap.tsx "cloud-minimap" (spec: a
    // "Site map" region) - the e2e fixture's names, docs/evidence/clouds/README.md "Deviations".
    readout: page.getByTestId("cloud-readout"),
    minimap: page.getByTestId("cloud-minimap"),
    inspectorTabs: tabs,
    palette,
    tool: (name) => palette.getByRole("button", { name, exact: true }),
    edl: page.getByRole("switch", { name: "EDL shading" }),
    cameras: page.getByRole("switch", { name: "Show camera positions" }),
    colour: (mode) =>
      page.getByRole("radiogroup", { name: "Colour by" }).getByRole("radio", { name: mode, exact: true }),
    findingsTab: tabs.getByRole("tab", { name: /^Findings/ }),
    measurementsTab: tabs.getByRole("tab", { name: /^Measurements/ }),
    hint,
    hintCancel: hint.getByRole("button", { name: "Cancel", exact: true }),
    callout,
    typeCombo: callout.getByRole("button", { name: /^Type:/ }),
    // PinCalloutView's Close (PinCallout.tsx): the callout a just-created finding switches to once
    // Enter creates it. Task 18 item 2: it stays open after one Escape (only a second Escape, once
    // the armed tool has already gone back to Orbit, deselects it), so a driver that presses one
    // Escape and moves on finds it still covering the next click.
    calloutClose: callout.getByRole("button", { name: "Close", exact: true }),
    photoList: page.getByRole("list", { name: "Photos that saw this point" }),
    view: (v) => page.getByRole("button", { name: v, exact: true }),
    async captureMissing() {
      await tabs.getByRole("tab", { name: /^Findings/ }).click();
      await page.getByRole("button", { name: CAPTURE_MENU }).click();
      await page.getByRole("menuitem", { name: "Capture missing views" }).click();
    },
  };
}

/**
 * Decodes image bytes in the page and returns 1000 quantised colour samples (40 x 25 grid, 5 bits per
 * channel), the first being the corner (the backdrop). A Blob, not fetch("data:…"): the packaged CSP
 * may refuse data: URLs.
 */
export function pageColours(page, bytes) {
  return page.evaluate(async (b64) => {
    const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([raw]));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const q = (x, y) => {
      const d = g.getImageData(x, y, 1, 1).data;
      return ((d[0] >> 3) << 10) | ((d[1] >> 3) << 5) | (d[2] >> 3);
    };
    const out = [q(0, 0)];
    for (let i = 0; i < 40; i++)
      for (let j = 0; j < 25; j++)
        out.push(q(Math.floor(((i + 0.5) * bmp.width) / 40), Math.floor(((j + 0.5) * bmp.height) / 25)));
    return out;
  }, Buffer.from(bytes).toString("base64"));
}
