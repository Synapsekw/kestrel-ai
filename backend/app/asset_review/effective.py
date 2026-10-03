"""A photo's effective review status (asset findings spec §5.4, coordinator ruling for D1): its
`image_review` row's status, else `none` when the photo is marked empty, else `not_assessed`.

One SQL expression, used by `GET /images/{id}/review` and by the image index's `review_status`
filter, so the chip a photo shows and the chip that finds it can never disagree. It imports only
the models, so `app.imagery.filters` can use it without an import cycle."""

from __future__ import annotations

from sqlalchemy import case, func, select

from app.db.models import Image, ImageReview


def effective_status():
    """Correlated on `Image`: use it in a query that selects from or joins `image`."""
    recorded = select(ImageReview.status).where(ImageReview.image_id == Image.id).scalar_subquery()
    implied = case((Image.marked_empty, "none"), else_="not_assessed")
    return func.coalesce(recorded, implied)
