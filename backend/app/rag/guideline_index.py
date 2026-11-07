import math
import re
from functools import lru_cache

import chromadb
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

from app.core.config import settings
from app.models.entities import BrandRule

CHUNK_SIZE = 900
CHUNK_OVERLAP = 120
MAX_RETRIEVAL_DISTANCE = 1.5


@lru_cache(maxsize=1)
def _client():
    return chromadb.PersistentClient(path=str(settings.chroma_path))


@lru_cache(maxsize=1)
def _embedding_function():
    if settings.embedding_model != "all-MiniLM-L6-v2":
        raise ValueError(
            "The local Chroma embedding provider currently supports all-MiniLM-L6-v2."
        )
    return DefaultEmbeddingFunction()


def _collection(organization_id: str):
    collection_name = f"org_{organization_id.replace('-', '')}"
    return _client().get_or_create_collection(
        name=collection_name,
        metadata={"organization_id": organization_id},
        embedding_function=_embedding_function(),
    )


def chunk_text(text: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []
    chunks = []
    start = 0
    while start < len(cleaned):
        end = min(start + CHUNK_SIZE, len(cleaned))
        if end < len(cleaned):
            boundary = cleaned.rfind(" ", start, end)
            if boundary > start + CHUNK_SIZE // 2:
                end = boundary
        chunks.append(cleaned[start:end].strip())
        if end == len(cleaned):
            break
        start = max(start + 1, end - CHUNK_OVERLAP)
    return [chunk for chunk in chunks if chunk]


def index_approved_rule(rule: BrandRule) -> None:
    collection = _collection(rule.organization_id)
    collection.delete(where={"rule_id": rule.id})
    if not rule.approved:
        return

    documents = chunk_text(f"{rule.title}. {rule.rule_text}")
    if not documents:
        return
    collection.upsert(
        ids=[f"{rule.id}:{index}" for index in range(len(documents))],
        documents=documents,
        metadatas=[
            {
                "organization_id": rule.organization_id,
                "rule_id": rule.id,
                "guideline_id": rule.guideline_id or "",
                "source_section": rule.source_section or "",
                "source_page": rule.source_page or 0,
                "category": rule.category,
            }
            for _ in documents
        ],
    )


def remove_rule_from_index(organization_id: str, rule_id: str) -> None:
    _collection(organization_id).delete(where={"rule_id": rule_id})


def retrieve_guideline_chunks(
    organization_id: str,
    query: str,
    limit: int = 8,
) -> list[dict]:
    collection = _collection(organization_id)
    count = collection.count()
    if count == 0 or not query.strip():
        return []

    result = collection.query(
        query_texts=[query],
        n_results=min(max(limit, 1), count),
        where={"organization_id": organization_id},
        include=["documents", "metadatas", "distances"],
    )
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]
    distances = result.get("distances", [[]])[0]

    filtered: list[dict] = []
    for document, metadata, raw_distance in zip(documents, metadatas, distances, strict=True):
        if not isinstance(document, str) or not document.strip():
            continue
        if not isinstance(metadata, dict):
            continue
        if metadata.get("organization_id") != organization_id:
            continue
        try:
            distance = float(raw_distance)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(distance):
            continue
        if distance > MAX_RETRIEVAL_DISTANCE:
            continue
        filtered.append({
            "text": document,
            "metadata": metadata,
            "distance": distance,
        })
    return filtered
