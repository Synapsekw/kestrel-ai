"""Results export: writes the project's reviewed detections to `exports/<stamp>/` (spec G2).

One `results_export` job orchestrates a set of pure per-format writers (`csv_out`, `yolo_out`,
`coco_out`, `html_out`), all fed by the same rows loaded once in `rows.py`.
"""
