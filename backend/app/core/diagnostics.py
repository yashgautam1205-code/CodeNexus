import logging
import traceback


def log_exception_trace(
    logger: logging.Logger,
    event: str,
    exception: Exception,
    **fields: int,
) -> None:
    details = " ".join(f"{name}={value}" for name, value in fields.items())
    stack = "".join(traceback.format_tb(exception.__traceback__)).rstrip()
    if not stack:
        stack = "Stack trace unavailable."
    logger.error(
        "%s%s exception_type=%s\n%s",
        event,
        f" {details}" if details else "",
        type(exception).__name__,
        stack,
    )
