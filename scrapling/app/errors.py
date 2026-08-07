class ScraperError(Exception):
    code: str = "scraper_error"
    status_code: int = 500

    def __init__(self, message: str, code: str | None = None, status_code: int | None = None) -> None:
        super().__init__(message)
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code


class TimeoutError_(ScraperError):
    code = "timeout"
    status_code = 504


class BlockedError(ScraperError):
    code = "blocked"
    status_code = 429


class UpstreamError(ScraperError):
    code = "upstream"
    status_code = 502
