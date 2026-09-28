"""The index budget on the real SQL (spec §17 flow 7, plan 2026-09-27-images-e ruling E5).

Deselected by default (a timing under the parallel gate measures the machine); run with
`pytest -m perf tests/test_images_scale.py` on an idle machine. The seeding follows I-BX's
`test_twenty_thousand_images_answer_in_one_response`.
"""

import statistics
import time

import pytest
from sqlalchemy import insert

from app.db.models import Image, Source

N = 20_000
BUDGET_S = 0.5


@pytest.mark.perf
def test_the_index_of_twenty_thousand_images_answers_in_500_ms(client, project, handle):
    with handle.session() as s:
        src = Source(folder="C:/flights/big", site="A")
        s.add(src)
        s.flush()
        s.execute(
            insert(Image),
            [
                {
                    "id": f"img-{n:05d}",
                    "path": f"images/big/{n:05d}.jpg",
                    "width": 4000,
                    "height": 3000,
                    "source_id": src.id,
                    "group_key": "",
                    "lat": 25.2 + (n // 200) * 0.0002,
                    "lon": 55.2 + (n % 200) * 0.0002,
                }
                for n in range(N)
            ],
        )
        s.commit()
    url = f"/api/v1/projects/{project['id']}/images/index"
    client.get(url, params={"fields": "geo"})  # warm the connection and SQLite's page cache
    times = []
    for _ in range(5):
        t0 = time.perf_counter()
        r = client.get(url, params={"fields": "geo"})
        times.append(time.perf_counter() - t0)
        assert r.status_code == 200 and r.json()["total"] == N
    median = statistics.median(times)
    print(f"index of {N} images: median {median * 1000:.0f} ms, runs {[round(t * 1000) for t in times]}")
    assert median <= BUDGET_S
