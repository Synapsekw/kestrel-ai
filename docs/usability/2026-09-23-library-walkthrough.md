---
type: usability
date: 2026-09-23
---

# Model library and project kinds: operator walkthrough

This is the "how to test this" for the model library and the training/detection project split
(plan `2026-09-23-model-library-and-project-kinds`, spec
`2026-09-23-train-detect-split-and-model-library-design` §4–§6). Run it on the **real app against
the real backend**, with a copy of a real project that has trained models.

The browser tests (`frontend/e2e/library.spec.ts`, `projects.spec.ts`, `past-detections.spec.ts`)
run against the Prism mock with fixed examples. The backend test
`test_library_adoption.py::test_real_project_copy` builds a pre-library project from scratch.
Neither opens one of your projects, and neither loads real weights. This walkthrough does both.

**Before you start:** copy one existing project folder that has trained models, for example
`E:\Projects\Ahmadia`, to `E:\Projects\Ahmadia-copy`. Work on the copy only. Note the size and
modified time of its `models\` folder.

Each step says what you should see. If a step does not match, stop and report which one.

1. **The library opens.** Start the app. The left rail shows **Projects** and **Library** above
   any project. Click **Library**. The screen is titled "Library" with no red "could not be opened"
   box. The folder `%APPDATA%\kestrel-ai\library` now exists and holds `library.db`, `models\` and
   `runs\`.
2. **An old project's models move into the library.** On **Projects**, open the folder
   `E:\Projects\Ahmadia-copy`. It opens on Home as a **Training** project; the pill in the project
   list says "Training".
   - While the models are being moved, Home shows an info box, "Moving this project's models into
     your library…", with a progress bar. The **Jobs** button in the header counts the job.
   - When it finishes, the box goes away.
   - The `models\` folder of the copy is unchanged (same size, same modified time). Nothing is
     deleted from it.
3. **The moved models are in the library.** Click **Library**. Every trained model of the copy is
   listed, with origin "Trained".
   - Click one. The detail says "Trained in <project name> on <dataset>" and shows the per-class
     table. The project name is the one stored in the project, so the copy still says "Ahmadia". If the project kept its training results, the training chart shows too.
   - Open the original `E:\Projects\Ahmadia` as well: its models are **not** added twice. The same
     weights file becomes one library model.
4. **A missing weights file is reported, and Retry picks it up.** Close the app. Rename one model's
   `best.pt` in a second copy of the project, then open that copy. Home shows a warning box, "One
   model could not be moved into your library", naming the model and "weights file not found:
   …". Everything else in the project works. Rename the file back and click **Retry**. The box
   goes away and the model appears in the library.
5. **Import a model file.** In **Library**, open **Import a model file**. Give it a name, choose a
   `.pt` file (for example one a partner sent you) and type a supplier. Click **Add to library**.
   - A progress row "Model import: <name>" appears while the file is checked.
   - When it finishes, the new model is selected and its detail shows "Supplied by <supplier>".
   - The original `.pt` file is untouched; the library holds its own copy.
   - Importing the same file again fails with "This weights file is already in the library as
     <name>."
6. **Add a starter model.** Open **Add a starter model**, pick a family and a size, and add it.
   A "Model download" progress row runs (it needs the internet the first time), then the model
   appears with origin "Starter".
7. **Export and delete.** Select a model and click **Export ONNX**. A progress row runs, then the
   detail lists the ONNX file. Click **Delete model** on a model a project uses: a warning names
   the projects first, and nothing is deleted until you click **Delete anyway**.
8. **Create a detection project.** On **Projects**, choose **Detection project** under "Kind of
   project". There is no class list to fill in. Give it a name and a new folder, then click
   **Create project**.
   - The rail shows **Images, Detect, Maps, Review, Export**. It shows no Label, Datasets or
     Train.
   - If the library is empty, **Detect** is locked and leads to the library.
9. **A training project keeps the training steps.** Open `Ahmadia-copy` again. The rail shows
   **Images, Label, Datasets, Train, Review, Export**, and **Library** at the top. Type
   `/p/<id>/query` in the address bar of the dev build, or follow an old bookmark: you land on
   Home, not on Detect.
10. **Past detections are read-only.** In `Ahmadia-copy`, which ran detections before the split,
    the rail shows **Past detections** under the steps. Click it.
    - The note says new detections belong in a detection project.
    - The old runs are listed and can be opened and exported. There is no New detection, Start,
      Estimate or Resume.
    - Switch to **Maps**: no Import map and no New run.
11. **Move a past map into a detection project.** In **Past detections → Maps**, open a map and
    click **Move to a detection project**. Pick the detection project from step 8, or choose "New
    detection project…" and give it a name and folder. Click **Move map**.
    - "Moving the map" progress runs. You can close the dialog and the copy carries on.
    - When it finishes, click **Open <project>**. The map, its zones and its labels are there.
      Its runs are not: run it again with a model from the library.
    - Moving the same map again fails with a readable message.
12. **Training registers into the library.** In a training project with a dataset, train a model
    (a short run is enough). When it finishes, the new model is in **Library** with origin
    "Trained" and this project's name. The detection project from step 8 can now choose it in
    **Detect**.
13. **The app still starts with a broken library.** Close the app. Rename
    `%APPDATA%\kestrel-ai\library\library.db` and put a text file named `library.db` that holds a few
    words in its place. An empty file will not do, because SQLite opens an empty file as a new
    database. Start the app. It opens. **Library** shows "The model library could not be opened"
    with the reason and the folder, and projects still open. Close the app and put the real
    `library.db` back.
