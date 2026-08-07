from typing import Any, Literal

from pydantic import BaseModel, Field


class BaseRequest(BaseModel):
    timeout_ms: int = Field(default=120_000, ge=5_000, le=600_000)


class LinkedInSearchRequest(BaseRequest):
    query: str
    max_results: int = Field(default=50, ge=1, le=200)
    location: str | None = None


class LinkedInProfile(BaseModel):
    public_identifier: str
    full_name: str | None = None
    headline: str | None = None
    location: str | None = None
    company: str | None = None
    linkedin_url: str | None = None


class GoogleMapsSearchRequest(BaseRequest):
    query: str
    location: str | None = None
    max_results: int = Field(default=60, ge=1, le=200)
    fetch_website_email: bool = False


class PlaceLocation(BaseModel):
    lat: float
    lng: float


class PlaceLead(BaseModel):
    place_id: str
    name: str
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    rating: float | None = None
    user_ratings_total: int | None = None
    types: list[str] = Field(default_factory=list)
    location: PlaceLocation | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class InstagramSearchRequest(BaseRequest):
    search: str
    search_type: Literal["user", "hashtag"] = "user"
    max_results: int = Field(default=30, ge=1, le=200)
    enrich_profiles: bool = True


class IgLead(BaseModel):
    username: str
    full_name: str | None = None
    bio: str | None = None
    followers: int | None = None
    following: int | None = None
    posts_count: int | None = None
    category: str | None = None
    external_url: str | None = None
    is_business_account: bool | None = None
    profile_pic_url: str | None = None
    email: str | None = None
    phone: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class OkResponse(BaseModel):
    ok: bool = True
    data: list[Any]


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    ok: bool = False
    error: ErrorBody
