import math

from app.errors import _json_safe


def test_json_safe_stringifies_non_finite_floats_anywhere_in_the_tree():
    nan, pos_inf, neg_inf = float("nan"), float("inf"), float("-inf")
    tree = {
        "loc": ["body", "vertices", 1, 0],
        "input": [1.0, nan],
        "nested": {"a": pos_inf, "b": neg_inf, "c": 2.5},
        "finite": 3,
        "text": "unchanged",
    }
    out = _json_safe(tree)
    assert out["input"] == [1.0, "nan"]
    assert out["nested"] == {"a": "inf", "b": "-inf", "c": 2.5}
    assert out["finite"] == 3
    assert out["text"] == "unchanged"
    # every stringified value round-trips back to the original meaning
    assert math.isnan(float(out["input"][1]))
    assert float(out["nested"]["a"]) == math.inf
    assert float(out["nested"]["b"]) == -math.inf


def test_404_uses_error_envelope(client):
    r = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "not_found"
    assert set(body["error"]) == {"code", "message", "details"}


def test_validation_error_uses_envelope(client):
    r = client.post("/api/v1/projects", json={"name": 5})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert "errors" in r.json()["error"]["details"]


def test_unknown_route_uses_error_envelope(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
