"""S0 stubs for query runs and pre-annotation (spec sections 7 and 8). S4 replaces them."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["query-runs"])

add_stubs(
    router,
    [
        ("POST", "/images/{imageId}/preannotate", "images preannotate"),
        ("POST", "/query-runs/estimate", "query-runs estimate"),
        ("GET", "/query-runs", "query-runs list"),
        ("POST", "/query-runs", "query-runs create"),
        ("GET", "/query-runs/{runId}", "query-runs get"),
        ("POST", "/query-runs/{runId}/promote", "query-runs promote"),
    ],
)
