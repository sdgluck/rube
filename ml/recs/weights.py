"""
How much one title says about someone's taste — a port of `titleWeight` in
packages/jobs/src/commands/we-think-youd-like/profile.ts.

The eval has to score what Tinkerbell will actually ship, so the history a
taste vector is built from is weighted exactly as the app weighs a person's
plays. MovieLens has ratings where Plex has completion, so the rating stands in
for `completionFactor`: a high rating is a finished title, a low one an
abandoned title (negative — it should push the vector away), the middle a
partial one.
"""

from __future__ import annotations

import numpy as np

DAY_S = 24 * 60 * 60
RECENCY_HALF_LIFE_DAYS = 120  # profile.ts RECENCY_HALF_LIFE_DAYS


def completion_factor(rating: np.ndarray) -> np.ndarray:
    return np.where(rating >= 3.5, 1.0, np.where(rating <= 2.0, -0.5, 0.3))


def title_weight(rating: np.ndarray, timestamp: np.ndarray, now: int) -> np.ndarray:
    age_days = np.maximum(0, now - timestamp) / DAY_S
    recency = 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)
    # One rating is one play: log2(1 + 1) = 1, so `plays` drops out.
    return completion_factor(rating) * recency
