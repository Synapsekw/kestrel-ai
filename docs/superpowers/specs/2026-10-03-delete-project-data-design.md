---
type: spec
date: 2026-10-03
status: draft
tags: [spec, maps, point-clouds, drawings, asset-models, ui]
related:
  [
    "[[2026-09-26-map-workspace-design]]",
    "[[2026-09-26-point-cloud-workspace-design]]",
    "[[2026-10-02-asset-model-builder-design]]",
    "[[2026-09-23-design-surfaces-design]]",
  ]
---

# Delete project data from the item

## 1. Goal

The operator can already delete an orthophoto, a DTM, a DSM, a drawing, a point cloud and an asset model. The control is hard to find: it sits inside a row menu, or inside a details dialog.

This spec puts an always-visible trash icon on the item itself. A click opens a confirmation. Nothing is deleted until the operator presses **Yes**.

**Done means all of the following:**

1. Each orthophoto, elevation (DTM, DSM or design surface) and drawing row in Maps → Layers has a trash icon that is visible without hovering and without opening the ⋯ menu.
2. Each point cloud in the cloud picker, and each asset model in the model picker, has the same icon. Clicking it does not open that item.
3. The icon opens a dialog titled "Are you sure?" with **Cancel** and **Yes**. **Yes** performs the delete that already exists. **Cancel** leaves the item in place.
4. A point cloud that has findings pinned on it still requires the existing second confirmation, which names the count, before those findings are deleted.
5. The ⋯ menu's Delete item, the drawings-list trash, the failed-import Delete button, and "Delete asset model…" in details open this same first dialog.

### Non-goals

- No new API, contract, backend or database change. The existing delete endpoints stay.
- No trash icon on annotation rows (findings, measurements, zones, labels) or on any other list.
- No change to what a successful delete removes, or to the rule that the source file on disk is left alone.
- The second cloud-findings dialog keeps its own title and its own confirm label. It is not reworded to "Are you sure?".

## 2. Budget

- **Background jobs:** none are added. Each delete is the existing request (`deleteMap`, `deleteSurface`, `deleteDrawing`, `deletePointCloud`, `deleteAssetModel`).
- **Bounded reads:** none are added. The icon is drawn from lists the screen already holds.

## 3. The icon

A small `IconButton`, size `sm`, icon `trash`, always visible, `aria-label` `Delete {name}`. On a layer row it sits at the trailing edge, immediately before the ⋯ menu.

| Place | Rows that get it |
| --- | --- |
| Maps → Layers | Base-map rows (orthophotos), every elevation row (DTM, DSM and a design surface), drawing rows |
| Point cloud picker | Every cloud in the list |
| Asset model picker | Every model in the list |

On a picker row the button is a sibling of the link, not inside it, so the click does not navigate. Annotation rows get no icon.

The ⋯ menus stay, including their Delete item. That item requests the same action the trash icon requests.

## 4. The confirmation

One dialog, shared by every entry point named in section 1.

- **Title:** "Are you sure?"
- **Buttons:** **Cancel** (closes, no request) and **Yes** (danger, runs the delete).
- **While the request runs:** **Yes** shows a loading state and both buttons are inert.
- **On success:** the dialog closes and the list drops the item, the same way it does today.
- **On failure:** the dialog stays open and shows the server message. The item stays.

The body is one sentence, by kind:

| Kind | Body |
| --- | --- |
| Orthophoto | Its runs, zones and labels are deleted with it. The original file stays where it is. |
| Elevation (DTM, DSM or design) | The surface and its folder are deleted. A volume that uses it must be deleted first. |
| Drawing | The drawing leaves the project; the original file is not touched. |
| Point cloud | The 3D view copy and the measurements go; the source file is not touched. |
| Asset model | Every version and its 3D model go with it. This can't be undone. |

**Point cloud with findings.** **Yes** sends the delete without `delete_findings`. If the server answers 409 `cloud_has_findings`, the first dialog is replaced by the existing second dialog: title `Delete the cloud and its N findings?`, body naming the count, buttons **Keep them** and **Delete cloud and N findings**. Only that second confirm sends `delete_findings=true`. A `job_running` failure stays on the first dialog.

## 5. Wiring

- **Orthophoto, DTM, DSM.** The trash calls the same `delete` raster action the row menu already calls. `RasterDialogs` renders the confirmation.
- **Drawing, in Layers.** The trash calls the same drawing `delete` intent the row menu already calls. `DrawingDialogs` renders the confirmation.
- **Drawing, on the drawings list.** The existing trash opens this confirmation instead of `Delete {name}?`.
- **Point cloud.** The picker trash, the details Delete button, and the failed-import Delete button all open `DeleteCloudDialog`. Its first step uses the title and buttons in section 4. The findings step is unchanged.
- **Asset model.** The picker trash and "Delete asset model…" in details both open this confirmation, then call `deleteAssetModel`. Success follows today's path: the model leaves the list, a toast names it, and the workspace leaves that model's route.

## 6. Tests

- A base-map row, an elevation row and a drawing row each expose `Delete {name}`. An annotation row does not.
- Clicking the icon opens "Are you sure?" and does not call the delete endpoint. **Cancel** closes it and still does not. **Yes** calls the endpoint that kind already uses.
- A cloud-picker trash and a model-picker trash do not change the route. **Yes** deletes. **Cancel** does not.
- A cloud whose delete returns `cloud_has_findings` shows the second dialog, and findings are deleted only after that confirm.
- A failed delete leaves the dialog open with the error, and the item still listed.

## 7. Execution DAG

Three units, one shared dialog wording.

- **Unit A — confirmation copy.** `ConfirmDeleteDialog` and the first step of `DeleteCloudDialog` use "Are you sure?" and **Yes**. The asset-model details confirm uses the same dialog. Independent of where the icon sits.
- **Unit B — layer-row icon.** Orthophoto, elevation and drawing rows. Depends on A only for the words the operator reads; the action it fires already exists.
- **Unit C — picker icons.** Cloud picker and asset-model picker, including "the click does not navigate". Depends on A the same way.

A is the critical path for the words. B and C can be built in parallel once A's dialog props exist. No backend unit.
