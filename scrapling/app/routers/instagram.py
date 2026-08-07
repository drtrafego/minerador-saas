from fastapi import APIRouter, Depends

from ..auth import require_secret
from ..scrapers.base import with_timeout
from ..scrapers.instagram_search import search
from ..schemas import InstagramSearchRequest, OkResponse

router = APIRouter(prefix="/instagram", dependencies=[Depends(require_secret)])


@router.post("/search", response_model=OkResponse)
async def instagram_search(req: InstagramSearchRequest) -> OkResponse:
    leads = await with_timeout(
        search(req.search, req.search_type, req.max_results, req.enrich_profiles),
        timeout_ms=req.timeout_ms,
    )
    return OkResponse(data=[lead.model_dump() for lead in leads])
