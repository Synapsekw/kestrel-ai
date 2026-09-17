def test_missing_token_is_401(anon):
    r = anon.get("/api/v1/health")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_wrong_token_is_401(anon):
    r = anon.get("/api/v1/health", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_token_as_query_parameter_is_accepted(anon):
    r = anon.get("/api/v1/health", params={"token": "test-token"})
    assert r.status_code == 200
