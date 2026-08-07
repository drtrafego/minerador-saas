from fastapi import APIRouter, Depends

from ..auth import require_secret
from ..scrapers.base import with_timeout
from ..scrapers.linkedin_search import search
from ..schemas import LinkedInSearchRequest, OkResponse

router = APIRouter(prefix="/linkedin", dependencies=[Depends(require_secret)])


@router.post("/search", response_model=OkResponse)
async def linkedin_search(req: LinkedInSearchRequest) -> OkResponse:
    profiles = await with_timeout(
        search(req.query, req.max_results, req.location),
        timeout_ms=req.timeout_ms,
    )
    return OkResponse(data=[p.model_dump() for p in profiles])
