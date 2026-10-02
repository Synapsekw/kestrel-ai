# Asset model builder (M1): how to test this

Operator walkthrough for the whole M1 feature. Button and message texts are the ones the app shows.

The HCl acceptance tolerances (spec section 11: dimensions, nozzle bearings and elevations, scan deviation) are checked separately by the coordinator. This walkthrough only checks that the feature works end to end.

## Before you start

- A provider key is saved. Open **Settings** in the left rail, find **Provider keys** (Anthropic, OpenAI, Google Gemini), paste the key, and press **Save Anthropic key** (or the matching button for another provider). **Test Anthropic** confirms it works.
- The GA drawing is imported as a Drawing. In the project, press **Add data**, choose the **Drawing** tile and import the file. Wait until it is no longer "Importing" (progress is in Jobs).

## Steps

1. Open the project and its **Asset models** tab. Press **New asset model…**, type the name "HCl tank" and press **Create**.
   Expected: the empty model workspace opens with the viewer, the model panel and the inspector.

2. In the Build bar press **Build with AI…**. In the **Build with AI** dialog tick the GA drawing under **Drawings**, choose **Anthropic** under **Provider**, and press **Start build**.
   Expected: the dialog closes and the Build bar switches to the live run. If the key is missing, the Provider row says so and links to **Add a key in App settings**.

3. Watch the Build bar: the phase (Sampling the scan, Reading sources, Building, Checking), the step count, the progress line, the latest step summary and a 64 px step thumbnail. Open the **Run** tab in the inspector.
   Expected: steps arrive one by one, with the agent, start time, phase and usage (k tokens) above them.

4. When the run finishes, a toast says "Built version 1" and the model shows in the viewer. Orbit it by dragging. In the view tools (top left) press **Cut** and set the **Cut bearing** slider to 90°, then try **Levels** and **Head off**. In the **Groups** list of the model panel, switch **Nozzle** off and on again. Use **Fit** and **Views** (Top, Front, Side, Iso view) as well.
   Expected: each tool changes the view and can be switched off again. The Nozzle switch hides and shows all nozzles.

5. Open the **Parts** tab and pick N7 (under Nozzle). The **Part** tab opens. Change **Projection** (mm), then press **Save as new version**.
   Expected: a toast "Saved version 2". Open **Versions**: v2 is listed as manual with the note "N7: projection <old> → <new> mm" and the **current** pill. The viewer keeps the old model until the new 3D file is built (a "building" pill shows), then swaps.

6. In **Versions** tick **Compare v1** and **Compare v2**.
   Expected: a "v1 → v2" panel lists N7 under **Changed** (projection). Then press **Restore** on v1.
   Expected: a toast "Restored version 1 as version 3". The list gains v3 with a note saying it was restored from version 1; v1 and v2 stay.

7. Press **Download** (above the inspector) and choose **3D model (GLB)**. Open the saved file "HCl tank-v3.glb" in Windows 3D Viewer. Press **Download** again and choose **Spec (JSON)**.
   Expected: the model shows in 3D Viewer; "HCl tank-v3.json" is readable JSON. The GLB item stays disabled while a version's 3D file is still building.

8. Start another build (**Build with AI…**, a source, **Start build**) and press **Stop** in the Build bar while it runs.
   Expected: the run ends with a toast "Saved a draft as version N". The bar reads "Stopped by you · Saved a draft as version N" and offers **Try again** (opens the dialog with the same choices) next to **Build with AI…** and **Refine…**. The **Run** tab lists the run as **Stopped**.

9. Start one more build and close the app while it runs. Reopen the app and the project's **Asset models** tab.
   Expected: the bar reads "Interrupted when the app closed" and, when the run had saved one, "Saved a draft as version N". The draft is listed in **Versions**. **Try again** is offered.

Optional: with a version present, **Refine…** opens **Refine with AI** (button **Start refine**); the Notes field takes a hint such as "N7 is at 270°, not 90°".
