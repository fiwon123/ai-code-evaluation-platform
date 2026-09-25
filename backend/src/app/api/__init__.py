from fastapi import APIRouter, Depends

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.challenges import router as challenges_router
from app.api.oauth import router as oauth_router
from app.api.results import router as results_router
from app.api.submissions import router as submissions_router
from app.core.rate_limit import enforce_rate_limit

api_router = APIRouter(dependencies=[Depends(enforce_rate_limit)])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(oauth_router, prefix="/auth/oauth", tags=["auth"])
api_router.include_router(challenges_router, prefix="/challenges", tags=["challenges"])
api_router.include_router(submissions_router, prefix="/submissions", tags=["submissions"])
api_router.include_router(results_router, prefix="/results", tags=["results"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
