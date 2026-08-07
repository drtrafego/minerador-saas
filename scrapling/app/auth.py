import secrets

from fastapi import Header, HTTPException, status

from .config import settings


async def require_secret(x_scrapling_secret: str | None = Header(default=None)) -> None:
    if not settings.shared_secret:
        raise HTTPException(status_code=500, detail="shared secret nao configurado")
    if not x_scrapling_secret or not secrets.compare_digest(x_scrapling_secret, settings.shared_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid secret")
