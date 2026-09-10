from app.core.database import Base, TimestampMixin, UUIDMixin

# Import models so their metadata is registered on Base.metadata
# for Alembic autogenerate.
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User

__all__ = [
    "Base",
    "Challenge",
    "EvaluationResult",
    "Submission",
    "TimestampMixin",
    "UUIDMixin",
    "User",
]
