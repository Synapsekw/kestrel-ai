# U4 final-review fix wave report (base 75da1bec)

All paths under backend/. Public names and signatures unchanged. No new error text carries paths or exception text.

## F1 drawing_text / drawing_view ping-pong
- app/asset_models/look/drawing.py: drawing_view branches on d.format (dxf -> "read its text with drawing_text"; other, i.e. LandXML -> "no page image and no text layer ... terrain or alignment file"). drawing_text: LandXML (in placement.VECTOR but not pdf/dxf) -> empty spans and a note with no pointer; raster keeps "read it with drawing_view"; empty-before-filter: PDF keeps "(a scan?) ... drawing_view", DXF "has no text entities."; empty after a region filter: "There is no text in that region."
- Tests: test_dxf_without_text_does_not_point_back_at_drawing_view, test_region_that_empties_a_text_page_says_no_text_in_region, test_landxml_text_and_view_do_not_point_at_each_other (in tests/test_asset_model_look_drawing.py).

## F2 argument validation
- look/__init__.py: new finite_numbers(); clamp_region requires exactly 4 finite numbers else LookError naming [x0, y0, x1, y1].
- cloud.py: _box()/_in_box require None or 6 finite numbers; cloud_fit rejects unknown kind (circle | cylinder_vertical | plane), "cylinder" aliased, result kind reports cylinder_vertical; cloud_slice lower-cases axis, rejects unknown axis, non-finite at_m, non-positive/non-finite thickness_m.
- photo.py: _box() forces >= 1 px per side inside the frame (also used for the draft-rescaled box). drawing_view window already max(1, ..): verified by test.
- Tests: parametrised bad-region tests (drawing clamp_region, photo_view), test_fit_rejects_a_malformed_region, test_fit_rejects_an_unknown_kind, test_fit_cylinder_is_an_alias_of_cylinder_vertical, test_slice_rejects_bad_arguments, test_slice_axis_is_case_insensitive, tiny-region tests (drawing, photo).

## F3 multi-chunk sampling
- sample_cloud already read module-level CHUNK at call time (no code change). Tests: test_multi_chunk_sampling_streams_in_chunks (CHUNK=50k, <= max_points, total 300000, progress >1 calls ending (total,total), one laspy.open), test_cancel_on_the_second_chunk_stops_the_pass (check_cancelled called exactly twice).

## F4 agent-facing messages
- photo.py: row lookup via get_image first (AppError -> "no photo with that id"), then image_file; AppError/OSError after that -> "The photo's file is not reachable." (branch is structural, since both errors share code not_found). Test: test_missing_file_is_distinguished_from_unknown_photo.
- drawing.py: _read_spans wraps reads, catching OSError, IndexError, ezdxf.DXFError / pypdfium2.PdfiumError (+ JobFailure from open_pdf) -> LookError "source file can't be read" (drawing_view pointer for PDF only). A missing source file gives the same sentence. Test: test_unreadable_source_is_a_look_error_without_paths[pdf|dxf].
- cloud.py source_of: fixed sentences; AppError code not_found -> "no point cloud with that id", other -> "still importing or failed to import"; JobFailure/OSError from check_source -> "source file is not reachable or changed since import". Tests: unknown (existing test assertion text changed from "can't be read" to the new fixed sentence, as the spec for F4 requires), not-ready, missing source.

## F5 photo draft-scale
- Tests: test_crop_at_draft_scale_respects_max_side (half-frame crop, max_side=500 -> longest side 500; a quarter crop at 500 would not trigger draft scale since 1000px > 500 does; both reach s<1), test_whole_frame_region_matches_the_whole_photo ((800, 600)).

## Evidence
- RED: with the new tests and the base (75da1bec) look/ sources: 37 failed, 26 passed.
- GREEN: `python -m pytest tests/test_asset_model_look_*.py -q` -> 63 passed, 3 warnings (only the known pyproj UserWarning).
- `ruff check app/asset_models tests` -> All checks passed; `ruff format --check app/asset_models tests` -> 431 files already formatted.

## Concerns
- One existing assertion text changed (test_source_of_unknown_cloud_raises_look_error match), forced by F4's required fixed sentence.
- Out-of-range PDF page (IndexError) is caught but has no dedicated test (the corrupt-source test covers the wrapper).
