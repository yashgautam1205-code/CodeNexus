import threading
import time
from collections import OrderedDict, deque
from math import ceil

from fastapi import HTTPException, Request, status

from app.models.entities import User

LOGIN_LIMIT = 10
LOGIN_WINDOW_SECONDS = 60
REGISTER_LIMIT = 5
REGISTER_WINDOW_SECONDS = 60 * 60
UPLOAD_LIMIT = 20
UPLOAD_WINDOW_SECONDS = 60 * 60
ANALYSIS_LIMIT = 30
ANALYSIS_WINDOW_SECONDS = 60 * 60
MAX_TRACKED_KEYS = 10_000


class AuthRateLimiter:
    def __init__(self) -> None:
        self._attempts: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._attempts.clear()

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            attempts = self._attempts.setdefault(key, deque())
            while attempts and attempts[0] <= cutoff:
                attempts.popleft()
            if len(attempts) >= limit:
                retry_after = max(1, ceil(attempts[0] + window_seconds - now))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many authentication attempts. Try again later.",
                    headers={"Retry-After": str(retry_after)},
                )
            attempts.append(now)
            self._attempts.move_to_end(key)
            while len(self._attempts) > MAX_TRACKED_KEYS:
                self._attempts.popitem(last=False)


auth_rate_limiter = AuthRateLimiter()


def _client_key(request: Request, action: str) -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"{action}:{client_host}"


def limit_login_attempts(request: Request) -> None:
    auth_rate_limiter.check(
        _client_key(request, "login"),
        LOGIN_LIMIT,
        LOGIN_WINDOW_SECONDS,
    )


def limit_registration_attempts(request: Request) -> None:
    auth_rate_limiter.check(
        _client_key(request, "register"),
        REGISTER_LIMIT,
        REGISTER_WINDOW_SECONDS,
    )


def limit_user_uploads(user: User) -> None:
    auth_rate_limiter.check(
        f"upload:{user.organization_id}:{user.id}",
        UPLOAD_LIMIT,
        UPLOAD_WINDOW_SECONDS,
    )


def limit_user_analyses(user: User) -> None:
    auth_rate_limiter.check(
        f"analysis:{user.organization_id}:{user.id}",
        ANALYSIS_LIMIT,
        ANALYSIS_WINDOW_SECONDS,
    )
