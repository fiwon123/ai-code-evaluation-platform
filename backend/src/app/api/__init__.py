from fastapi import APIRouter, Depends

from app.api.auth import router as auth_router
from app.api.challenges import router as challenges_router
from app.api.submissions import router as submissions_router
from app.core.rate_limit import enforce_rate_limit

api_router = APIRouter(dependencies=[Depends(enforce_rate_limit)])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(challenges_router, prefix="/challenges", tags=["challenges"])
api_router.include_router(submissions_router, prefix="/submissions", tags=["submissions"])
