import asyncio
import logging
import re
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.core.config import settings
from app.services.malware_scanner import (
    MalwareDetectedError,
    MalwareScannerUnavailableError,
    UploadsDisabledError,
    ensure_uploads_enabled,
    scan_upload,
)

logger = logging.getLogger(__name__)


def safe_filename(filename: str) -> str:
    original = filename.replace("\\", "/").rsplit("/", 1)[-1]
    sanitized = re.sub(r"[^A-Za-z0-9._ -]", "_", original).strip(" .")
    return sanitized[:200] or "upload"


async def read_validated_upload(
    upload: UploadFile,
    allowed_extensions: set[str],
) -> tuple[str, bytes]:
    try:
        ensure_uploads_enabled()
    except UploadsDisabledError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    filename = safe_filename(upload.filename or "")
    extension = Path(filename).suffix.lower()
    if extension not in allowed_extensions:
        raise HTTPException(status_code=415, detail="Unsupported file type.")
    content = await upload.read(settings.max_upload_size_bytes + 1)
    if not content:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")
    if len(content) > settings.max_upload_size_bytes:
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB limit.")
    if extension == ".pdf" and not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid PDF.")
    if extension == ".docx" and not content.startswith(b"PK"):
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid DOCX.")
    try:
        await asyncio.to_thread(scan_upload, content)
    except MalwareDetectedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except UploadsDisabledError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except MalwareScannerUnavailableError as exc:
        logger.exception("Upload malware scanning is unavailable")
        raise HTTPException(
            status_code=503,
            detail="Upload scanning is unavailable. Try again later.",
        ) from exc
    return filename, content


def persist_upload(organization_id: str, filename: str, content: bytes) -> str:
    root = settings.upload_path.resolve()
    destination_dir = root / organization_id
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{uuid4().hex}{Path(filename).suffix.lower()}"
    destination.write_bytes(content)
    return str(destination)


def cleanup_failed_upload(path: str) -> None:
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        logger.exception("Could not remove upload after its database transaction failed")
