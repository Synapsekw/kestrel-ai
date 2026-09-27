"""After I-C0, today's editor keeps working on main: the kept image and box operations still answer
their old fields, and a box drawn with the old body still saves (plan 2026-09-27-images-c0, Review
Focus 5). The new fields are asserted by the units that fill them (I-BA, I-BK, I-BX)."""

from findings_helpers import insert_box

OLD_BOX_FIELDS = {"id", "image_id", "class_id", "x", "y", "w", "h", "angle", "review_state", "created_at"}


def test_the_old_editor_calls_still_work(client, handle, project):
    class_id = project["classes"][0]["id"]
    image_id, _ = insert_box(handle, class_id)
    base = f"/api/v1/projects/{project['id']}"

    r = client.post(f"{base}/images/{image_id}/boxes", json={"class_id": class_id, "x": 10, "y": 10, "w": 20, "h": 20})
    assert r.status_code == 201, r.text
    assert OLD_BOX_FIELDS <= set(r.json())

    r = client.get(f"{base}/images/{image_id}/boxes")
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 2

    r = client.get(f"{base}/images/{image_id}")
    assert r.status_code == 200, r.text
    assert r.json()["id"] == image_id
