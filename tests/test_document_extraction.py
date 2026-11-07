from io import BytesIO

import pytest
from docx import Document

from app.services.document_extraction import DocumentExtractionError, extract_document_text


def test_docx_extraction_preserves_heading_as_section_reference():
    document = Document()
    document.add_heading("Claims", level=1)
    document.add_paragraph("Avoid absolute performance promises.")
    buffer = BytesIO()
    document.save(buffer)

    extracted = extract_document_text("guide.docx", buffer.getvalue())

    assert "[Section: Claims]" in extracted
    assert "Avoid absolute performance promises." in extracted


def test_corrupt_docx_returns_clear_extraction_error():
    with pytest.raises(DocumentExtractionError, match="corrupted"):
        extract_document_text("broken.docx", b"not a docx archive")
