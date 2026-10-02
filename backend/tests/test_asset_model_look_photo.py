import io

import pytest
from PIL import Image

from app.asset_models.look import LookError
from app.asset_models.look.photo import photo_view


@pytest.fixture
def big_photo_id(client, project_id, import_source, make_jpeg, tmp_path):
    """Import one 4000x3000 photo into the project and return its image id."""
    folder = tmp_path / "photos"
    folder.mkdir()
    make_jpeg(folder / "big.jpg", 4000, 3000)
    import_source(project_id, folder)
    rows = client.get(f"/api/v1/projects/{project_id}/images").json()["items"]
    assert len(rows) == 1
    return rows[0]["id"]


def test_whole_photo_is_downscaled(handle, big_photo_id):
    img = photo_view(handle, big_photo_id, max_side=800)
    assert (img.width, img.height) == (800, 600)


def test_region_crop_keeps_detail(handle, big_photo_id):
    img = photo_view(handle, big_photo_id, [0.0, 0.0, 0.25, 0.25], max_side=1600)
    assert (img.width, img.height) == (1000, 750)
    Image.open(io.BytesIO(img.jpeg)).verify()


def test_unknown_photo(handle):
    with pytest.raises(LookError):
        photo_view(handle, "nope")


def test_crop_at_draft_scale_respects_max_side(handle, big_photo_id):
    img = photo_view(handle, big_photo_id, [0.0, 0.0, 0.5, 0.5], max_side=500)
    assert max(img.width, img.height) == 500


def test_whole_frame_region_matches_the_whole_photo(handle, big_photo_id):
    img = photo_view(handle, big_photo_id, [0.0, 0.0, 1.0, 1.0], max_side=800)
    assert (img.width, img.height) == (800, 600)


def test_tiny_region_still_yields_an_image(handle, big_photo_id):
    img = photo_view(handle, big_photo_id, [0.5, 0.5, 0.5011, 0.5011], max_side=800)
    assert img.width >= 1 and img.height >= 1


@pytest.mark.parametrize("region", [[0, 0, 1], [0, 0, 1, 1, 1], [0, 0, float("nan"), 1], "abcd"])
def test_bad_region_is_a_look_error(handle, big_photo_id, region):
    with pytest.raises(LookError, match=r"\[x0, y0, x1, y1\]"):
        photo_view(handle, big_photo_id, region)


def test_missing_file_is_distinguished_from_unknown_photo(handle, big_photo_id):
    from app.datasets.images import get_image

    (handle.folder / get_image(handle, big_photo_id)[0].path).unlink()
    with pytest.raises(LookError, match="file is not reachable") as e:
        photo_view(handle, big_photo_id, max_side=800)
    assert str(handle.folder) not in e.value.message
