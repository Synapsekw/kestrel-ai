"""Where the reference machine keeps its real weights and aerial frames.

The defaults are the operator's folders; another machine points the GPU, live and sample-frame tests at
its own copies with `KESTREL_MODELS_DIR` and `KESTREL_FRAMES_DIR`. Tests that need them skip when the
files are missing, so an unset variable on a machine without an E: drive is a skip, not a failure.
"""

import os
from pathlib import Path

MODELS_DIR = Path(os.environ.get("KESTREL_MODELS_DIR", "E:/Dev/Yolo/models"))
FRAMES_DIR = Path(os.environ.get("KESTREL_FRAMES_DIR", "E:/Dev/Yolo/data/raw/ahmadia"))
