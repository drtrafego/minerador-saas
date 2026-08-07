from fastapi import APIRouter, Depends

from ..auth import require_secret
from ..scrapers.base import with_timeout
from ..scrapers.google_maps_search import search
from ..schemas import GoogleMapsSearchRequest, OkResponse

router = APIRouter(prefix="/google-maps", dependencies=[Depends(require_secret)])


@router.post("/search", response_model=OkResponse)
async def google_maps_search(req: GoogleMapsSearchRequest) -> OkResponse:
    places = await with_timeout(
        search(req.query, req.location, req.max_results, req.fetch_website_email),
        timeout_ms=req.timeout_ms,
    )
    return OkResponse(data=[p.model_dump() for p in places])
