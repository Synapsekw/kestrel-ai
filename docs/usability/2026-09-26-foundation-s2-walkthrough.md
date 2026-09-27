---
type: walkthrough
date: 2026-09-26
plan: docs/superpowers/plans/2026-09-26-foundation-s2-app-screens.md
---

# How to test the app sections (Foundation S2)

1. Start the app. In the rail, open **Catalogue**. If your projects were upgraded, a banner says how
   many types came from them, and the table shows only those types.
2. Open one of them, for example a crack type that came from a project. Set **Kind** to Defect and
   choose **Save type**. A note offers **Create findings from accepted annotations of this type**.
   Choose it, then **Follow in Jobs**: the backfill job shows in Jobs under the **Model library**
   project filter.
3. Back in Catalogue, choose **Done** on the banner. It disappears and the table shows every type.
4. Choose **New type** (top bar). Name it "Dump-Truck" when "Dump truck" exists: the editor refuses
   it and offers **Use existing**.
5. Open **Severity**. Rename level 2, add a level, and watch the preview bars and pills change as
   you type. Choose **Save scale**. Remove the top level and save again. If findings still use it,
   the message names the projects.
6. Open **Models → Datasets → New dataset**. Tick two projects and a few types. The image count
   updates as you tick. Choose **Create dataset**: the dataset shows as Building, then Ready, with
   its sources and sample images. No images were copied. The builder also opens straight from the
   address `/models/datasets?new=1`, and from a project's old Datasets link (with that project
   already ticked).
7. On the dataset, choose **Build export**, then **Train on this dataset**. The New training run
   drawer opens with the dataset chosen. While another run is still preparing that dataset
   (building its export, or active on a dataset that has not been exported yet), **Start
   training** is held back with "Another run is preparing this dataset; start when it has
   finished." Once the export is ready, start a short run (Epochs 3 under More options).
8. The run opens with live epoch, mAP50 and loss. When it finishes, its curve appears and the model
   is in **Models → Library**.
9. In **Library**, open the new model, then **Class mapping**. Classes that match a type say "by
   name". Map one leftover class and choose **Save class mapping**.
10. In **Training**, tick two finished runs and choose **Compare**: both mAP50 curves share one axis.
11. Open **Jobs**. Switch between Running, Queued, Finished and Failed, filter by a project, open a
    job to read its log, and cancel a running one. Then go to any other screen (Catalogue, a
    project, Settings) while a job ends: its success or failure toast appears there too, and a
    failure's **Show log** opens that job in Jobs.
12. Open **Settings**. Under Appearance, choose Visual effects **Reduced**: the frosted glass turns
    solid at once. Turn on **Reduce motion**, then type your name and press Enter ("Saved" shows;
    the name is stored by the backend, not the browser). Restart the app: all three are
    remembered.
13. Open a project → **Settings**. The old Classes section is gone; in its place is the project's
    **Types** list. Type part of a catalogue type's name and choose **Add …**, reorder with the
    arrows, give one type a hotkey override, and choose **Save types**. Then set that override back
    to **Default** (or **None**) and save again: the override is cleared, and reopening Settings
    shows it cleared.
14. Open a project's **Images** tab and choose **Label next**. The first unlabeled image opens
    in the editor. In a project where every image is labelled, it says so instead.
