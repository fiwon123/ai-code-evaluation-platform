from pydantic import BaseModel


class PaginatedResponse[T](BaseModel):
    """Generic envelope for offset-paginated list endpoints."""

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int
