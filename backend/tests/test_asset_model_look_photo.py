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
