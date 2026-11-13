import hashlib
import ipaddress
import json
import logging
from datetime import datetime, timezone
from math import isfinite
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from app.core.config import settings

logger = logging.getLogger(__name__)
TAVILY_SEARCH_URL = "https://api.tavily.com/search"


class ExternalSearchError(RuntimeError):
    pass


def _valid_source_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError:
        return False
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if not hostname or "." not in hostname:
        return False
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        return False
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        return False
    return (
        parsed.scheme == "https"
        and parsed.username is None
        and parsed.password is None
        and not parsed.fragment
    )


def search_claim_sources(claim: str) -> dict:
    provider = settings.external_search_provider
    if provider == "disabled":
        return {"status": "not_configured", "provider": provider, "sources": []}
    if provider != "tavily":
        return {"status": "provider_unsupported", "provider": provider, "sources": []}
    if not settings.tavily_api_key.strip():
        return {"status": "missing_credentials", "provider": provider, "sources": []}

    payload = json.dumps(
        {
            "api_key": settings.tavily_api_key,
            "query": claim,
            "search_depth": "advanced",
            "max_results": settings.external_search_max_results,
            "include_answer": False,
            "include_raw_content": False,
        }
    ).encode("utf-8")
    request = Request(
        TAVILY_SEARCH_URL,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=settings.external_search_timeout_seconds) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.warning("External search request failed: %s", type(exc).__name__)
        raise ExternalSearchError("External search is temporarily unavailable.") from exc

    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise ExternalSearchError("External search returned an invalid response.")

    retrieved_at = datetime.now(timezone.utc).isoformat()
    sources = []
    for result in data.get("results", []):
        if not isinstance(result, dict):
            continue
        url = result.get("url")
        content = result.get("content")
        if not _valid_source_url(url) or not isinstance(content, str) or not content.strip():
            continue
        provider_score = result.get("score")
        if not isinstance(provider_score, (int, float)) or not isfinite(provider_score):
            provider_score = None
        published_at = result.get("published_date")
        if not isinstance(published_at, str):
            published_at = None
        sources.append(
            {
                "id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:24],
                "title": str(result.get("title") or url)[:500],
                "text": content.strip()[:12000],
                "source_url": url,
                "publisher_domain": (urlsplit(url).hostname or "").lower(),
                "source_type": "external",
                "provider": provider,
                "published_at": published_at,
                "publication_date_status": (
                    "provided" if published_at and published_at.strip() else "missing"
                ),
                "retrieved_at": retrieved_at,
                "provider_relevance_score": provider_score,
                "citation_valid": True,
            }
        )
    return {
        "status": "results_found" if sources else "no_results",
        "provider": provider,
        "retrieved_at": retrieved_at,
        "sources": sources,
    }
