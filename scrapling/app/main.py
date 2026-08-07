import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import settings
from .errors import ScraperError
from .routers import google_maps, health, instagram, linkedin
from .schemas import ErrorBody, ErrorResponse

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("scrapling-service")

app = FastAPI(title="Minerador Scrapling Service", version="1.0.0")

app.include_router(health.router, prefix="/v1")
app.include_router(linkedin.router, prefix="/v1")
app.include_router(google_maps.router, prefix="/v1")
app.include_router(instagram.router, prefix="/v1")


@app.exception_handler(ScraperError)
async def scraper_error_handler(_req: Request, exc: ScraperError) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=exc.code, message=str(exc)))
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())


@app.exception_handler(Exception)
async def unhandled_exception_handler(_req: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled", exc_info=exc)
    body = ErrorResponse(error=ErrorBody(code="internal", message=str(exc)))
    return JSONResponse(status_code=500, content=body.model_dump())
