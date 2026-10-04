# Findings on the asset: operator walkthrough (how to test this)

These steps cover the whole feature on the installed build (artifact port phase 1, units C0 to R1 plus the
close-out fixes). Use a scratch project, never a live one.

The numbers in brackets are what the acceptance runs got on the operator's data; see `damac-replay.md`,
`damac-recompute.md`, `ebsm-replay.md` and `reports.md` in this folder.

## A. Brands (D2, U6)

1. Install the new build and open **App settings**, then **Report brands**. There are two built-ins, e& and White
   label. e& is selected, and its preview band is navy with a dark red end. **Delete brand** is not offered for a built-in.
2. Under **Logos**, import the three e& logos from the kit's `brands\eand\` folder: logo on light, logo on dark,
   and flat. Each appears on its chip. Logo on dark also appears at the bottom left of the preview band.
   The files are copied into the app data folder, never into a project.

## B. Photos and the model (J1, J2, U2)

3. Create a scratch project. Choose **Add data**, then **Images**, and pick the DAMAC photo folder (the folders the
   kit's photo map points at).
   - Tick **Keep every photo** ("Turns off the duplicate check. Use it for inspection kit photo sets.").
   - Without it, 43 of the 4,538 kit photos are dropped as duplicates even at threshold 0 (the hashes are equal,
     but the photos differ).
   - With it, all 4,538 photos land.
4. Choose **Asset models**. Use the model picker, then **Import a GLB…**. Pick a GLB, choose its axes, optionally
   enter its latitude, longitude and ground altitude, then **Import**. A toast says the version is importing, and the
   view shows the model when the job ends.
   The import only rotates the model; it never moves it sideways. A GLB that is not centred on its base keeps its
   offset: the DAMAC kit GLB footprint is centred near (11.6, -7.3). Bearings and sides come out right as long as
   the cameras use the same frame.
5. **Photos** menu, then **Estimate poses from photo metadata**. A toast says the job started, and another says
   how many photos were posed.

## C. Import an inspection review (J5, U2)

6. Use the model picker, then **Import inspection review…** (or **Add data**, then **Inspection review**).
   - Pick the kit job folder (`...\DAMAC Hills Tower Facade Digital Report\_rebuild\job\`) and the image set from step 3.
   - Choose **Check the folder**.
   - The preview lists the matched photos (4,538 of 4,538), the unmatched ones with reasons, the sightings it will
     make (1,441) and the kit classes to map.
   - If any photos are unmatched, the dialog says to import the photo folder again with **Keep every photo** on.
     A re-import with it on also brings back the photos an earlier import dropped.
7. Map each kit class to a defect type and run the import. The progress goes through matching, poses,
   sightings, photo statuses, placing and grouping.
   Expected DAMAC numbers:
   - 656 findings (182 at severity 2, 474 at severity 1);
   - 715 patches, 625 pins and 101 not placed;
   - 45 uncertain photos.
8. Repeat steps 3 to 7 for EBSM: the GEOTAGED photos and `EBSM Digital Report\_rebuild\job\`.
   Expected EBSM numbers:
   - 78 findings (77 at severity 2, 1 at severity 1) and 78 patches;
   - photo review: 53 uncertain, 159 no finding, 9 not assessed;
   - 377 sightings.
   Each finding is one photo, with one sighting per marked region. A photo whose marks are all tiny fragments
   still gets one sighting, its largest fragment.
   A cancelled import undoes its sightings, boxes and kit poses, but keeps the photo statuses it wrote.

## D. The asset workspace (U1, U2)

9. In **Asset models**, open **Model**:
   - switch **See through** on, and the model turns glassy;
   - switch **Turn slowly** on and off;
   - switch **Street map** on, and the streets appear under the model (checked in a browser on DAMAC).
10. Open **Photos**. The count and the outcome legend show. **Include context photos** adds the no-finding photos.
    Click a camera glyph: the Photos topic opens on that photo. **View from here** looks through it, and **Back
    to the model view** returns.
11. Open **Findings**. The list shows zone, side and height. Filter by a zone, then by **Not placed**. Pick a finding
    and press **Focus**: the view turns square on to it.
12. **Findings** menu, then **Compute placements**. Two toasts follow: placements, then regroup.
    - On DAMAC the run took about 180 s.
    - Rectangles become pins and polygons become patches (spec rule): 686 patches, 652 pins, 103 not placed,
      and 652 findings.
    - **Regroup findings** asks first, then runs.

## E. Split inspection (U3)

13. From a finding, press **Inspect**: the model is on the left and the photo on the right. The model is turned
    square on to the finding. The photo shows the outline filled in the severity colour. Move **Overlay opacity**.
14. Hold **Space** (or **Hold to compare**): the fill disappears, and returns when you let go.
15. Press the **right arrow**: the next photo that saw the finding opens, and the HUD reads "Sighting 2 of n".
    Press **J** and **K** to move to the next and previous findings.
16. Drag the splitter, or focus it and press **Home** and **End**: it stops at 22 % and 75 %. Reload, and the split
    stays where you left it.
17. **Split off this sighting** on a finding with two or more sightings: a new finding opens. **Merge into…** a
    finding of the same type: the survivor opens, and the merged one shows as closed, with a comment.
18. Press **?** to see the inspection's keys.

## F. Register, Overview and photo review (D1, U4, U5)

19. Open **Findings**, filter the source by **Asset**, and pick the model under **Asset model**.
    - Height, Side, Zone, Component and Sightings columns show. Unplaced findings say "Unplaced".
    - Click a zone chip: the list narrows.
    - **Gallery** shows thumbnail tiles. Click a tile to open the inspector.
20. Click **Uncertain photos**: the Images tab opens with the photo review filter on Uncertain (DAMAC 45, EBSM 53).
21. Open **Overview**. The big pane shows the model turning slowly; drag it to orbit.
    - Beside it, **Findings on the asset** shows the silhouette, the level lines and one dot per placed finding.
    - Hover a dot to see its number, severity, zone, side and height. Click it to open the finding.
    - Each "<Status>: N photos" count matches the Images list filtered to that status.
    - On DAMAC (4,538 photos) the Overview answers in about 15 ms.

## G. Reports (R1)

22. Choose **Reports**, then **New report**. Set up the report:
    - turn on **Asset summary**;
    - under **Finding pages**, set **Pages for** to severity 2 and above;
    - in **Findings table**, tick Zone, Side, Height and Sightings;
    - under **Cover**, pick **Brand: e&**.
    The preview takes the e& colours.
    The 3D locator in the *preview* shows "The 3D view is drawn when the report renders." until a render
    (or a placement job) has loaded the mesh. The PDF always has it.
23. In **Tables**, choose **Asset sightings**, tick PDF and CSV, then **Render**.
    - DAMAC: 248 pages, one page per severity 2 finding (182) plus the register.
    - EBSM: 165 pages. Its finding pages say "N regions on 1 photo"; DAMAC's say "seen in N photos".
    - `sightings.csv` opens in Excel with the kit's 21 columns. On DAMAC it matches the kit's own CSV row for row
      on grouping, severity, placement and side.
    - The PDF shows the e& header logo, the cover logo at the bottom left of the band, and the brand's footer line.

## Known gaps (not blockers)

- After a recompute regroup, the Overview's recent-findings strip can show merged-away (closed) findings with
  no thumbnail.
- On a recompute, the 27 DAMAC rectangle boxes that the kit drew as patches become pins. The spec rule
  stands (operator ruling).
- Street map was checked in a browser, not inside the installed app: check it once on the installed build.
