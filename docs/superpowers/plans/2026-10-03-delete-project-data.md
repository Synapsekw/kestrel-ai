# Delete project data from the item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an always-visible trash icon on each orthophoto, elevation model, drawing, point cloud and asset model, and delete only after an "Are you sure?" dialog's **Yes**.

**Architecture:** The trash icon calls the delete action that already exists. `ConfirmDeleteDialog` and the first step of `DeleteCloudDialog` share the words "Are you sure?" and **Yes**. A point cloud that has findings still uses its second dialog unchanged. Picker icons sit beside the row link, so the click does not navigate.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, existing `@/ui` `IconButton`, `Dialog` and `ConfirmDeleteDialog`. No API or contract change.

**Spec:** `docs/superpowers/specs/2026-10-03-delete-project-data-design.md`

## Global Constraints

- No API, contract, backend or database change. Do not edit `contract/`.
- Trash icon: `IconButton`, size `sm`, icon `trash`, always visible, `aria-label` `Delete {name}`. On a layer row it sits at the trailing edge, immediately before the ⋯ menu.
- Confirmation title is exactly `Are you sure?`. Buttons are **Cancel** and **Yes** (danger). Nothing is deleted until **Yes**.
- Bodies, copied verbatim:
  - Orthophoto: `Its runs, zones and labels are deleted with it. The original file stays where it is.`
  - Elevation (DTM, DSM or design): `The surface and its folder are deleted. A volume that uses it must be deleted first.`
  - Drawing: `The drawing leaves the project; the original file is not touched.`
  - Point cloud: `The 3D view copy and the measurements go; the source file is not touched.`
  - Asset model: `Every version and its 3D model go with it. This can't be undone.`
- A point cloud with findings still shows `Delete the cloud and its N findings?` with **Keep them** and **Delete cloud and N findings**. Only that second confirm sends `delete_findings=true`.
- Do not reword any other delete (zones, findings, measurements, images, site areas, volumes list, reports). Those dialogs keep the button label **Delete**.
- The greyed unavailable layer row keeps no menu and no trash.
- Work in a task worktree (`.claude/worktrees/delete-data` on `task/delete-data`), created at execution time with the using-git-worktrees skill. Stage by path. Never `git add -A`.
- Sentence case. Colours and radii come from existing primitives.

---

### Task 1: Confirmation says "Are you sure?" and Yes

**Files:**
- Modify: `frontend/src/mapws/layers/ConfirmDeleteDialog.tsx`
- Modify: `frontend/src/mapws/layers/ConfirmDeleteDialog.test.tsx`
- Modify: `frontend/src/mapws/layers/RasterDialogs.tsx` (the delete branch, around the `ConfirmDeleteDialog` title)
- Modify: `frontend/src/mapws/layers/RasterDialogs.test.tsx` (the three `name: "Delete"` clicks inside the confirm)
- Modify: `frontend/src/mapws/drawings/DrawingDialogs.tsx`
- Modify: `frontend/src/mapws/drawings/DrawingDialogs.test.tsx`
- Modify: `frontend/src/drawings/DrawingsScreen.tsx`
- Modify: `frontend/src/drawings/DrawingsScreen.test.tsx`
- Modify: `frontend/src/clouds/workspace/DeleteCloudDialog.tsx` (first step only)
- Modify: `frontend/src/clouds/workspace/DeleteCloudDialog.test.tsx`
- Modify: `frontend/src/clouds/workspace/CloudWorkspace.test.tsx` (`deleteFromDetails`)
- Modify: `frontend/src/assetmodels/workspace/ModelDetailsDialog.tsx`
- Modify: `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx` (the details-delete test)
- Test: the files above

**Interfaces:**
- Consumes: nothing new.
- Produces: `ConfirmDeleteDialog` confirm button accessible name is `Yes`. Callers pass `title="Are you sure?"`. `DeleteCloudDialog`'s first dialog has accessible name `Are you sure?` and confirm button `Yes`. Its findings dialog is unchanged. `ModelDetailsDialog` opens `ConfirmDeleteDialog` (title `Are you sure?`, body the asset-model sentence) instead of the inline alert whose button was `Delete permanently`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/mapws/layers/ConfirmDeleteDialog.test.tsx`, change the click to **Yes**:

```tsx
await userEvent.click(screen.getByRole("button", { name: "Yes" }));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/mapws/layers/ConfirmDeleteDialog.test.tsx`

Expected: FAIL. Unable to find a button named `Yes`.

- [ ] **Step 3: Write the minimal implementation**

In `ConfirmDeleteDialog.tsx`, change the danger button's text from `Delete` to `Yes`. Leave **Cancel**, the error alert, and the loading behaviour as they are.

In `RasterDialogs.tsx`, set the delete dialog title to `"Are you sure?"`. Leave both body strings as they are (they already match the spec).

In `DrawingDialogs.tsx` and `DrawingsScreen.tsx`, set the title to `"Are you sure?"`. Leave `DELETE_CONFIRM` as the body.

In `RasterDialogs.test.tsx`, the three confirm clicks become:

```tsx
await userEvent.click(screen.getByRole("button", { name: "Yes" }));
```

Do not change the menu assertions (`Delete map`, `Delete surface`). Those menu labels stay.

In `DrawingDialogs.test.tsx`, replace the dialog query and the confirm click:

```tsx
const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
expect(dialog).toHaveTextContent("The drawing leaves the project; the original file is not touched.");
fireEvent.click(within(dialog).getByRole("button", { name: "Yes" }));
```

In `DrawingsScreen.test.tsx`:

```tsx
const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
fireEvent.click(within(dialog).getByRole("button", { name: "Yes" }));
```

In `DeleteCloudDialog.tsx`, change only the first dialog (the `findings === null` branch):

```tsx
<Dialog
  open
  title="Are you sure?"
  description="The 3D view copy and the measurements go; the source file is not touched."
  onClose={close}
  footer={
    <>
      <Button onClick={close}>Keep it</Button>
      <Button variant="danger" loading={busy} onClick={() => run(false)}>
        Yes
      </Button>
    </>
  }
>
```

Leave the findings dialog's title, **Keep them**, and `Delete cloud and N findings` exactly as they are. Leave the source-path paragraph in the first dialog.

In `DeleteCloudDialog.test.tsx`, the first confirm click in all three tests becomes `name: "Yes"`. The job-running assertion becomes:

```tsx
expect(screen.getByRole("dialog", { name: "Are you sure?" })).toBeInTheDocument();
```

Leave the findings dialog name and `Delete cloud and 3 findings` as they are.

In `CloudWorkspace.test.tsx`, `deleteFromDetails` keeps the details button named `Delete` (that button lives in `CloudDetails` and is not the confirm). Change only the confirm:

```tsx
const confirm = await screen.findByRole("dialog", { name: "Are you sure?" });
await userEvent.click(within(confirm).getByRole("button", { name: "Yes" }));
```

In `ModelDetailsDialog.tsx`, import `ConfirmDeleteDialog` from `@/mapws/layers/ConfirmDeleteDialog`. Remove the inline `Alert` that asks `Delete ${model.name}?` and its **Delete permanently** button. When `confirming` is true, render:

```tsx
<ConfirmDeleteDialog
  title="Are you sure?"
  body="Every version and its 3D model go with it. This can't be undone."
  onConfirm={async () => {
    await deleteAssetModel(api, projectId, model.id);
    onDeleted(model);
  }}
  onClose={() => setConfirming(false)}
/>
```

Keep the **Delete asset model…** button that sets `confirming` to true. Drop the `busy === "delete"` path; `ConfirmDeleteDialog` owns the in-flight state. A thrown delete stays inside that dialog (it already shows `messageOf`).

In `AssetModelWorkspace.test.tsx`, the details-delete test becomes:

```tsx
fireEvent.click(within(dialog).getByRole("button", { name: /delete asset model…/i }));
expect(requests.some((r) => r.method === "DELETE")).toBe(false);
const confirm = screen.getByRole("dialog", { name: "Are you sure?" });
expect(confirm).toHaveTextContent(/every version and its 3d model go with it/i);
fireEvent.click(within(confirm).getByRole("button", { name: "Yes" }));
```

Leave the rest of that test (the DELETE request, the navigation, the empty state) as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```
pnpm -C frontend exec vitest run src/mapws/layers/ConfirmDeleteDialog.test.tsx src/mapws/layers/RasterDialogs.test.tsx src/mapws/drawings/DrawingDialogs.test.tsx src/drawings/DrawingsScreen.test.tsx src/clouds/workspace/DeleteCloudDialog.test.tsx src/clouds/workspace/CloudWorkspace.test.tsx src/assetmodels/workspace/AssetModelWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mapws/layers/ConfirmDeleteDialog.tsx frontend/src/mapws/layers/ConfirmDeleteDialog.test.tsx frontend/src/mapws/layers/RasterDialogs.tsx frontend/src/mapws/layers/RasterDialogs.test.tsx frontend/src/mapws/drawings/DrawingDialogs.tsx frontend/src/mapws/drawings/DrawingDialogs.test.tsx frontend/src/drawings/DrawingsScreen.tsx frontend/src/drawings/DrawingsScreen.test.tsx frontend/src/clouds/workspace/DeleteCloudDialog.tsx frontend/src/clouds/workspace/DeleteCloudDialog.test.tsx frontend/src/clouds/workspace/CloudWorkspace.test.tsx frontend/src/assetmodels/workspace/ModelDetailsDialog.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx
git commit -m "$(cat <<'EOF'
fix: confirm data deletes with Are you sure and Yes

EOF
)"
```

---

### Task 2: Trash icon on orthophoto, elevation and drawing rows

**Files:**
- Create: `frontend/src/mapws/chrome/LayerRowView.test.tsx`
- Modify: `frontend/src/mapws/chrome/LayerRowView.tsx`
- Modify: `frontend/src/mapws/layers/RasterDialogs.test.tsx`
- Modify: `frontend/src/mapws/drawings/DrawingDialogs.test.tsx`
- Test: the files above

**Interfaces:**
- Consumes: a row menu item with `id === "delete"` and `onSelect(): void` (`rasterMenu`, `drawingRowMenu` from Task 1's dialogs). The confirm button those dialogs render is named `Yes`.
- Produces: `LayerRowView` renders `IconButton` `Delete {row.name}` when `kind.menu(row)` contains `id === "delete"`, immediately before the ⋯ `MenuButton`. Clicking it calls that item's `onSelect`. Rows whose menu has no such item, and unavailable rows, render no trash icon.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/mapws/chrome/LayerRowView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LayerKind, LayerRow } from "../layers/layerRegistry";
import { rasterMenu } from "../layers/rasterMenu";
import { baseMapRows, elevationRows } from "../layers/rasterRows";
import { drawingRowMenu } from "../drawings/drawingRows";
import { mapLayer, surfaceLayer, SEP } from "../test/rasterFixtures";
import { LayerRowView } from "./LayerRowView";

const state = { visible: true, opacity: 100 };
const [ortho] = baseMapRows({ layers: [mapLayer("sep", SEP)] });
const [dem] = elevationRows({ layers: [surfaceLayer("dem", SEP, "dem")] }); // name is "dem"
const drawing: LayerRow = {
  key: "drawing:d1",
  kind: "drawing",
  group: "drawings",
  id: "d1",
  name: "foundation-plan",
  meta: "",
  date: null,
};

function show(row: LayerRow, kind: LayerKind) {
  return render(
    <LayerRowView
      row={row}
      kind={kind}
      state={state}
      notInCompare={false}
      onState={vi.fn()}
      onMove={vi.fn()}
      onDropOn={vi.fn()}
    />,
  );
}

const kind = (id: string, menu: LayerKind["menu"]): LayerKind => ({
  id,
  group: "base",
  icon: "trash",
  rows: () => [],
  menu,
});

describe("LayerRowView delete", () => {
  it("shows a trash icon on an orthophoto, an elevation row and a drawing, and not on a row without delete", () => {
    for (const [row, rowKind, name] of [
      [ortho, kind("map", rasterMenu), `Delete ${ortho.name}`],
      [dem, kind("surface", rasterMenu), "Delete dem"],
      [drawing, kind("drawing", drawingRowMenu), "Delete foundation-plan"],
    ] as const) {
      const view = show(row, rowKind);
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
      view.unmount();
    }
    show(
      drawing,
      kind("note", () => [{ id: "style", label: "Style", onSelect: () => {} }]),
    );
    expect(screen.queryByRole("button", { name: "Delete foundation-plan" })).toBeNull();
  });

  it("the trash calls the menu's delete action and does not remove the row menu", async () => {
    const onSelect = vi.fn();
    show(
      drawing,
      kind("drawing", () => [{ id: "delete", label: "Delete…", onSelect }]),
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete foundation-plan" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "foundation-plan actions" })).toBeInTheDocument();
  });
});
```

`mapLayer` and `surfaceLayer` are exported from `frontend/src/mapws/test/rasterFixtures.ts`. `surfaceLayer("dem", SEP, "dem")` names the row `dem`.

Change `setup` in `RasterDialogs.test.tsx` to accept an optional extra node, rendered in the same tree as `RasterDialogs`. Existing callers pass nothing.

```tsx
function setup(extra?: ReactNode) {
  const { api, requests } = fakeClient([
    // unchanged routes
  ]);
  renderInWorkspace(
    <>
      <RasterDialogs projectId={PROJECT_ID} frame={UTM33} />
      {extra}
      <LocationProbe />
    </>,
    { api },
  );
  return requests;
}
```

Add `import type { ReactNode } from "react"` and `import { LayerRowView } from "../chrome/LayerRowView"`. Add this test inside the existing describe:

```tsx
it("the row trash opens Are you sure, and Cancel deletes nothing", async () => {
  const requests = setup(
    <LayerRowView
      row={ortho}
      kind={{ id: "map", group: "base", icon: "trash", rows: () => [], menu: rasterMenu }}
      state={{ visible: true, opacity: 100 }}
      notInCompare={false}
      onState={() => {}}
      onMove={() => {}}
      onDropOn={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: `Delete ${ortho.name}` }));
  expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
  expect(dialog).toHaveTextContent(
    "Its runs, zones and labels are deleted with it. The original file stays where it is.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(requests.some((r) => r.method === "DELETE")).toBe(false);
});
```

**Yes** deleting the map is already covered by `"deletes after confirming, and shows the server's 409"` once that test clicks `Yes`.

In `DrawingDialogs.test.tsx`, add an optional second argument to `show`:

```tsx
function show(routes: Parameters<typeof fakeClient>[0] = [], extra?: ReactNode) {
  // unchanged store and client setup
  renderInWorkspace(
    <>
      <DrawingDialogs projectId={PROJECT_ID} frame={SITE_FRAME} />
      {extra}
    </>,
    { stores, api: client.api },
  );
  return { stores, requests: client.requests };
}
```

Add this test. It needs the DELETE route the existing delete test uses, and a row whose id is `pdfDrawing.id` so `drawingRowMenu` posts that id:

```tsx
it("the row trash opens Are you sure, Cancel sends nothing, and Yes deletes", async () => {
  const row: LayerRow = {
    key: `drawing:${pdfDrawing.id}`,
    kind: "drawing",
    group: "drawings",
    id: pdfDrawing.id,
    name: pdfDrawing.name,
    meta: "",
    date: null,
  };
  const { requests } = show(
    [{ method: "DELETE", path: new RegExp(`/drawings/${pdfDrawing.id}$`), status: 204 }],
    <LayerRowView
      row={row}
      kind={{ id: "drawing", group: "drawings", icon: "trash", rows: () => [], menu: drawingRowMenu }}
      state={{ visible: true, opacity: 100 }}
      notInCompare={false}
      onState={() => {}}
      onMove={() => {}}
      onDropOn={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: `Delete ${pdfDrawing.name}` }));
  const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
  expect(dialog).toHaveTextContent("The drawing leaves the project; the original file is not touched.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: `Delete ${pdfDrawing.name}` }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Are you sure?" })).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
});
```

Import `LayerRowView`, `drawingRowMenu`, `LayerRow`, and `userEvent` in that test file. `pdfDrawing.name` is `foundation-plan · p2`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/mapws/chrome/LayerRowView.test.tsx src/mapws/layers/RasterDialogs.test.tsx src/mapws/drawings/DrawingDialogs.test.tsx`

Expected: FAIL. `Delete ${name}` is not in the document.

- [ ] **Step 3: Write the minimal implementation**

In `LayerRowView.tsx`, after `const menu = kind?.menu?.(row) ?? [];`:

```tsx
const remove = menu.find((item) => item.id === "delete");
```

Replace the menu cell (the `menu.length > 0 ? <MenuButton ...> : <span />` block) with:

```tsx
<div className="flex items-start">
  {remove && (
    <IconButton size="sm" icon="trash" label={`Delete ${row.name}`} onClick={() => remove.onSelect()} />
  )}
  {menu.length > 0 ? (
    <MenuButton
      iconOnly
      icon="more"
      size="sm"
      variant="ghost"
      label={`${row.name} actions`}
      items={menu}
    />
  ) : (
    !remove && <span />
  )}
</div>
```

Leave the unavailable-row early return unchanged, so that row still has no trash icon.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/mapws/chrome/LayerRowView.test.tsx src/mapws/layers/RasterDialogs.test.tsx src/mapws/drawings/DrawingDialogs.test.tsx`

Expected: PASS. Then `pnpm -C frontend exec eslint src/mapws/chrome/LayerRowView.tsx src/mapws/chrome/LayerRowView.test.tsx --max-warnings 0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mapws/chrome/LayerRowView.tsx frontend/src/mapws/chrome/LayerRowView.test.tsx frontend/src/mapws/layers/RasterDialogs.test.tsx frontend/src/mapws/drawings/DrawingDialogs.test.tsx
git commit -m "$(cat <<'EOF'
feat: show a delete icon on map, elevation and drawing rows

EOF
)"
```

---

### Task 3: Trash icon on each point cloud in the picker

**Files:**
- Modify: `frontend/src/clouds/workspace/CloudPanel.tsx` (`CloudPicker` and `CloudPanel`)
- Modify: `frontend/src/clouds/workspace/CloudPanel.test.tsx`
- Modify: `frontend/src/clouds/workspace/CloudWorkspace.tsx` (`ReadyProps`, both inner `CloudPanel`s, and the two `CloudPanel`s in `CloudWorkspace`)
- Test: `frontend/src/clouds/workspace/CloudPanel.test.tsx`

**Interfaces:**
- Consumes: `DeleteCloudDialog` from Task 1. First confirm is `Are you sure?` / `Yes`. `deleted(id: string)` already exists in `CloudWorkspace`.
- Produces: `CloudPanel` gains `onDeleted(id: string): void`. Each cloud row in the picker has a trash icon that is not inside the `Link`. Choosing it closes the popover and opens `DeleteCloudDialog` for that cloud. **Yes** calls `onDeleted(id)` after the existing delete succeeds.

- [ ] **Step 1: Write the failing test**

Add to `CloudPanel.test.tsx`. Import `LocationProbe` from `@/test/render`, `within` from Testing Library, and `CLOUD_ID` from `@/test/cloudFixtures`.

```tsx
it("asks before deleting a listed cloud, and the trash does not open that cloud", async () => {
  const onDeleted = vi.fn();
  const { api, requests } = fakeClient([
    { method: "DELETE", path: new RegExp(`/pointclouds/c2$`), status: 204 },
  ]);
  renderWithProviders(
    <>
      <CloudPanel
        projectId={PROJECT_ID}
        cloud={exampleCloud}
        clouds={[exampleCloud, { ...exampleCloud, id: "c2", name: "Tower", status: "importing" }]}
        onImport={vi.fn()}
        onDetails={vi.fn()}
        onDeleted={onDeleted}
      />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}` },
  );
  await userEvent.click(screen.getByRole("button", { name: /^Point cloud:/ }));
  await userEvent.click(screen.getByRole("button", { name: "Delete Tower" }));
  expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/${CLOUD_ID}`);
  expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
  expect(dialog).toHaveTextContent("The 3D view copy and the measurements go");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onDeleted).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /^Point cloud:/ }));
  await userEvent.click(screen.getByRole("button", { name: "Delete Tower" }));
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("c2"));
  expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/${CLOUD_ID}`);
});
```

The existing panel tests construct `CloudPanel` without `onDeleted`. Give `onDeleted` a default of `() => {}` in the component so those tests still compile, or add `onDeleted={vi.fn()}` to every existing call in this file. Prefer the explicit prop on every call in the test file, and a required prop on the component.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/clouds/workspace/CloudPanel.test.tsx`

Expected: FAIL. `onDeleted` is not a prop, or `Delete Tower` is missing.

- [ ] **Step 3: Write the minimal implementation**

Add `onDeleted(id: string): void` to `CloudPicker` and `CloudPanel`.

In `CloudPicker`, keep a `pending` state of `PointCloud | null`. Each list row becomes a flex row: the existing `Link` (`min-w-0 flex-1`) and a sibling

```tsx
<IconButton
  size="sm"
  icon="trash"
  label={`Delete ${c.name}`}
  onClick={() => {
    setOpen(false);
    setPending(c);
  }}
/>
```

Render `DeleteCloudDialog` as a sibling of the `Popover`, not inside it:

```tsx
{pending && (
  <DeleteCloudDialog
    open
    projectId={projectId}
    cloud={pending}
    onClose={() => setPending(null)}
    onDeleted={() => {
      const id = pending.id;
      setPending(null);
      onDeleted(id);
    }}
  />
)}
```

Import `IconButton` from `@/ui` and `DeleteCloudDialog` from `./DeleteCloudDialog`.

Thread `onDeleted` through `ReadyProps` and every `<CloudPanel` in `CloudWorkspace.tsx` (the embedded one, the no-view one, and the importing/failed one). Pass the existing `deleted` function:

```tsx
onDeleted={deleted}
```

`deleted` is in `CloudWorkspace`, so `ReadyWorkspace` must receive it as a prop and pass it on. The failed-import **Delete** button stays; it already opens `DeleteCloudDialog`, which Task 1 reworded.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/clouds/workspace/CloudPanel.test.tsx src/clouds/workspace/CloudWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/clouds/workspace/CloudPanel.tsx frontend/src/clouds/workspace/CloudPanel.test.tsx frontend/src/clouds/workspace/CloudWorkspace.tsx
git commit -m "$(cat <<'EOF'
feat: delete a point cloud from its row in the picker

EOF
)"
```

---

### Task 4: Trash icon on each asset model in the picker

**Files:**
- Create: `frontend/src/assetmodels/workspace/ModelPanel.test.tsx`
- Modify: `frontend/src/assetmodels/workspace/ModelPanel.tsx`
- Modify: `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx` (`ModelWorkspaceProps`, the `ModelPanel` call, and the `ModelWorkspace` call)
- Test: `frontend/src/assetmodels/workspace/ModelPanel.test.tsx` and `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDeleteDialog` from Task 1 (button `Yes`, title passed by the caller). `deleteAssetModel(api, projectId, id)` from `@/api/assetModels`. The workspace's existing deleted-model path: `setDeleted`, `toast("ok", `Deleted ${name}`)`, `reload()`, `navigate(`/p/${projectId}/models`)`.
- Produces: `ModelPanel` and `ModelWorkspace` gain `onDeleted(model: AssetModel): void`. Each model row has a trash icon outside the `Link`. **Yes** calls `deleteAssetModel`, then `onDeleted`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/assetmodels/workspace/ModelPanel.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MODEL } from "@/test/assetModelFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { ModelPanel } from "./ModelPanel";

const other = { ...MODEL, id: "m2", name: "Stack", tag: null, current_version: null, status: "empty" as const };

function show(onDeleted = vi.fn(), routes: Parameters<typeof fakeClient>[0] = []) {
  const client = fakeClient(routes);
  renderWithProviders(
    <>
      <ModelPanel
        projectId={PROJECT_ID}
        model={MODEL}
        models={[MODEL, other]}
        onNew={vi.fn()}
        onDetails={vi.fn()}
        onDeleted={onDeleted}
        groups={[]}
        hiddenGroups={new Set()}
        onGroup={vi.fn()}
        overlay={null}
        overlayAvailable={false}
        onOverlay={vi.fn()}
      />
      <LocationProbe />
    </>,
    { api: client.api, route: `/p/${PROJECT_ID}/models/m1` },
  );
  return client;
}

describe("ModelPanel delete", () => {
  it("asks before deleting a listed model, and the trash does not open it", async () => {
    const onDeleted = vi.fn();
    const { requests } = show(onDeleted, [
      { method: "DELETE", path: /\/asset-models\/m2$/, status: 204 },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Stack" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1`);
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
    expect(dialog).toHaveTextContent("Every version and its 3D model go with it. This can't be undone.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onDeleted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Stack" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: "m2" })));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1`);
  });

  it("keeps the dialog open when the delete fails", async () => {
    const onDeleted = vi.fn();
    show(onDeleted, [
      {
        method: "DELETE",
        path: /\/asset-models\/m2$/,
        status: 409,
        body: { error: { code: "conflict", message: "A run is still going.", details: {} } },
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Stack" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("A run is still going.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Are you sure?" })).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
```

`AssetModelStatus` is `empty | building | ready`, so `status: "empty"` is valid.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/assetmodels/workspace/ModelPanel.test.tsx`

Expected: FAIL. `onDeleted` is not a prop, or `Delete Stack` is missing.

- [ ] **Step 3: Write the minimal implementation**

Add `onDeleted(model: AssetModel): void` to `ModelPicker` and `ModelPanel`.

In `ModelPicker`, each list row is a flex row: the existing `Link` (`min-w-0 flex-1`) and a sibling `IconButton` `Delete ${m.name}`. Clicking it closes the popover and sets `pending` to that model. As a sibling of the `Popover`:

```tsx
{pending && (
  <ConfirmDeleteDialog
    title="Are you sure?"
    body="Every version and its 3D model go with it. This can't be undone."
    onConfirm={async () => {
      await deleteAssetModel(api, projectId, pending.id);
      onDeleted(pending);
    }}
    onClose={() => setPending(null)}
  />
)}
```

Use `useApi()` inside `ModelPicker`. Import `ConfirmDeleteDialog` from `@/mapws/layers/ConfirmDeleteDialog`, `deleteAssetModel` from `@/api/assetModels`, and `IconButton` from `@/ui`.

Pass `onDeleted` from `AssetModelWorkspace` into `ModelWorkspace` and from there into `ModelPanel`. Use the same function the details dialog already calls:

```tsx
const removed = (m: AssetModel) => {
  setDetailsOpen(false);
  setDeleted((d) => new Set(d).add(m.id));
  toast("ok", `Deleted ${m.name}`);
  reload();
  navigate(`/p/${projectId}/models`);
};
```

Replace the inline `onDeleted` on `ModelDetailsDialog` with `removed`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/workspace/ModelPanel.test.tsx src/assetmodels/workspace/AssetModelWorkspace.test.tsx`

Expected: PASS. Then `pnpm -C frontend lint`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/workspace/ModelPanel.tsx frontend/src/assetmodels/workspace/ModelPanel.test.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx
git commit -m "$(cat <<'EOF'
feat: delete an asset model from its row in the picker

EOF
)"
```

---

## Spec coverage

- Trash on orthophoto, elevation (including design) and drawing rows: Task 2. A design surface is an elevation row; `rasterMenu` gives it `id: "delete"`, so it gets the icon with no extra branch.
- Trash on cloud and model pickers, click does not navigate: Tasks 3 and 4.
- "Are you sure?" / **Cancel** / **Yes**, and the five bodies: Task 1, plus the picker dialogs in Tasks 3 and 4.
- Findings second confirm unchanged: Task 1.
- Menu Delete, drawings-list trash, failed-import Delete, and details Delete open the same first dialog: Task 1 (they already open these dialogs; only the words change).
- Failure leaves the dialog open: existing `ConfirmDeleteDialog` and `DeleteCloudDialog` behaviour; Task 4 adds the model-picker failure test.
