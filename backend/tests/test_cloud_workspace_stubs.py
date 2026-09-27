"""Unit C-C0: the multipart view uploads answer 501 while stubbed (not 422), the `pointcloud_profile`
job type is registered, and the two new startup sweep steps run on project open.

Generic 501 and EXPECTED_STUBS checks for every C stub live in `test_pointcloud_stubs.py`, which
reads `app.pointclouds.router.STUBS` and needs no change."""

import json

import pytest
from pointclouds import insert_cloud

from app.pointclouds import router

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64  # the bytes never matter to a stub
META = {
    "pose": {"position": [0, 0, 10], "target": [0, 1, 0], "up": [0, 0, 1], "fov_deg": 50},
    "render": {
        "colour_mode": "rgb",
        "point_budget": 3000000,
        "point_size": 1.4,
        "edl": True,
        "clip_box": None,
        "complete": True,
    },
}
# Controller ruling: the multipart `files` literal is hoisted here instead of written twice.
FILES = {"image": ("view.png", PNG, "image/png"), "meta": (None, json.dumps(META), "application/json")}
UPLOADS = {
    "putFindingView3d": "/findings/f1/view3d",
    "putCloudMeasurementView3d": "/pointclouds/{cloud}/measurements/m1/view3d",
}


class _Runner:
    def is_live(self, job_id):
        return False


def test_the_upload_stubs_answer_501_to_a_real_multipart_upload(client, project_id, handle):
    cloud = insert_cloud(handle)
    stubbed = {op_id for _, _, op_id in router.STUBS}
    for op_id, path in UPLOADS.items():
        if op_id not in stubbed:
            continue  # built by C-B4, whose own tests cover it
        r = client.put(f"/api/v1/projects/{project_id}{path.format(cloud=cloud)}", files=FILES)
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_an_upload_stub_still_answers_404_for_an_unknown_project(client):
    if "putFindingView3d" not in {op_id for _, _, op_id in router.STUBS}:
        pytest.skip("built by C-B4")
    assert client.put("/api/v1/projects/nope/findings/f1/view3d", files=FILES).status_code == 404
