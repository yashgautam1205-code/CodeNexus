from io import BytesIO
from zipfile import BadZipFile, ZipFile

import fitz
from docx import Document
from docx.opc.exceptions import PackageNotFoundError


class DocumentExtractionError(ValueError):
    pass


MAX_PDF_PAGES = 1000
MAX_DOCX_ENTRIES = 2000
MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024


def _validate_docx_container(content: bytes) -> None:
    with ZipFile(BytesIO(content)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_DOCX_ENTRIES:
            raise DocumentExtractionError("The DOCX contains too many archive entries.")
        if any(entry.flag_bits & 0x1 for entry in entries):
            raise DocumentExtractionError("Encrypted DOCX files are not supported.")
        if sum(entry.file_size for entry in entries) > MAX_DOCX_UNCOMPRESSED_BYTES:
            raise DocumentExtractionError("The DOCX expands beyond the processing limit.")
        names = {entry.filename for entry in entries}
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise DocumentExtractionError("The uploaded file is not a valid DOCX document.")


def extract_document_text(filename: str, content: bytes) -> str:
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if suffix == "pdf":
            with fitz.open(stream=content, filetype="pdf") as document:
                if document.is_encrypted:
                    raise DocumentExtractionError("Encrypted PDF files are not supported.")
                if document.page_count > MAX_PDF_PAGES:
                    raise DocumentExtractionError("The PDF contains too many pages to process.")
                pages = []
                for index, page in enumerate(document):
                    page_text = page.get_text().strip()
                    if page_text:
                        pages.append(f"[Page {index + 1}]\n{page_text}")
                text = "\n\n".join(pages)
        elif suffix == "docx":
            _validate_docx_container(content)
            document = Document(BytesIO(content))
            paragraphs = []
            section = None
            for paragraph in document.paragraphs:
                value = paragraph.text.strip()
                if not value:
                    continue
                if paragraph.style and paragraph.style.name.startswith("Heading"):
                    section = value
                paragraphs.append(f"[Section: {section}]\n{value}" if section else value)
            text = "\n\n".join(paragraphs)
        elif suffix == "txt":
            if b"\0" in content:
                raise DocumentExtractionError("The text document contains binary data.")
            text = content.decode("utf-8-sig")
        else:
            raise DocumentExtractionError("Unsupported document type.")
    except (
        fitz.FileDataError,
        fitz.EmptyFileError,
        UnicodeDecodeError,
        BadZipFile,
        PackageNotFoundError,
        KeyError,
    ) as exc:
        raise DocumentExtractionError("The document is empty, corrupted, or unreadable.") from exc
    except Exception as exc:
        if isinstance(exc, DocumentExtractionError):
            raise
        raise DocumentExtractionError("The document could not be processed.") from exc

    if not text.strip():
        raise DocumentExtractionError("The document contains no readable text.")
    return text.strip()
