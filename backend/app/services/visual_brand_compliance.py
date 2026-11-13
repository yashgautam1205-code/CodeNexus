from __future__ import annotations

import logging
import warnings
from io import BytesIO
from typing import Any

from app.core.config import settings

try:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
except Exception:  # pragma: no cover - optional dependency
    Image = None
    ImageEnhance = None
    ImageFilter = None
    ImageOps = None

try:
    import pytesseract  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    pytesseract = None

try:
    import cv2
    import numpy as np
except Exception:  # pragma: no cover - optional dependency
    cv2 = None
    np = None

logger = logging.getLogger(__name__)
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


def is_supported_image(filename: str) -> bool:
    suffix = "" if "." not in filename else filename.rsplit(".", 1)[1].lower()
    return f".{suffix}" in SUPPORTED_IMAGE_EXTENSIONS


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    value = color.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        return (0, 0, 0)
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def _rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    def linearize(channel: int) -> float:
        value = channel / 255
        return ((value + 0.055) / 1.055) ** 2.4 if value > 0.04045 else value / 12.92

    red, green, blue = (linearize(channel) for channel in rgb)
    x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047
    y = red * 0.2126 + green * 0.7152 + blue * 0.0722
    z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883

    def lab_component(value: float) -> float:
        return value ** (1 / 3) if value > 0.008856 else (7.787 * value) + (16 / 116)

    fx, fy, fz = (lab_component(value) for value in (x, y, z))
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    left_lab = _rgb_to_lab(left)
    right_lab = _rgb_to_lab(right)
    return sum((a - b) ** 2 for a, b in zip(left_lab, right_lab)) ** 0.5


def _dominant_colors(content: bytes, max_colors: int = 5) -> list[str]:
    if Image is None:
        return []
    try:
        with Image.open(BytesIO(content)) as image:
            resized = image.convert("RGB").resize((64, 64))
            quantized = resized.quantize(
                colors=max_colors,
                method=Image.Quantize.MEDIANCUT,
            )
            palette = quantized.getcolors(maxcolors=64 * 64)
            rgb_palette = quantized.getpalette()
            if not palette or rgb_palette is None:
                return []
            colors = sorted(palette, reverse=True)
            result = []
            for _, index in colors[:max_colors]:
                start = index * 3
                result.append(
                    _rgb_to_hex(
                        (
                            rgb_palette[start],
                            rgb_palette[start + 1],
                            rgb_palette[start + 2],
                        )
                    )
                )
            return result
    except Exception:
        return []


def _dominant_color_regions(
    content: bytes,
    max_colors: int = 8,
) -> list[dict[str, Any]]:
    if Image is None:
        return []
    try:
        with Image.open(BytesIO(content)) as image:
            original_width, original_height = image.size
            resized = image.convert("RGB").resize((128, 128))
            quantized = resized.quantize(
                colors=max_colors,
                method=Image.Quantize.MEDIANCUT,
            )
            labels = np.asarray(quantized, dtype=np.uint8) if np is not None else None
            palette = quantized.getpalette()
            color_counts = sorted(quantized.getcolors(128 * 128) or [], reverse=True)
            if palette is None or not color_counts:
                return []

            regions = []
            minimum_area = max(24, int(128 * 128 * 0.008))
            for count, palette_index in color_counts:
                mask = (labels == palette_index).astype(np.uint8) if labels is not None else None
                components = []
                if cv2 is not None and mask is not None:
                    _, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
                    components = [
                        (int(stat[4]), int(stat[0]), int(stat[1]), int(stat[2]), int(stat[3]))
                        for stat in stats[1:]
                        if int(stat[4]) >= minimum_area
                    ]
                    if not components:
                        continue
                else:
                    components = [(count, 0, 0, 128, 128)]
                components.sort(reverse=True)
                start = palette_index * 3
                color = _rgb_to_hex(
                    (palette[start], palette[start + 1], palette[start + 2])
                )
                for area, left, top, width, height in components[:3]:
                    regions.append(
                        {
                            "color": color,
                            "area_fraction": round(area / (128 * 128), 4),
                            "bounding_box": [
                                round(left / 128, 4),
                                round(top / 128, 4),
                                round(width / 128, 4),
                                round(height / 128, 4),
                            ],
                            "image_dimensions": [original_width, original_height],
                        }
                    )
            return regions
    except Exception:
        return []


def _has_high_color_variation(content: bytes) -> bool:
    if Image is None:
        return False
    try:
        with Image.open(BytesIO(content)) as image:
            resized = image.convert("RGB").resize((64, 64))
            colors = resized.getcolors(maxcolors=64 * 64) or []
            return len(colors) / (64 * 64) >= 0.35
    except Exception:
        return False


def _safe_ocr_text(content: bytes) -> tuple[list[str], float, list[dict[str, Any]]]:
    if Image is None or pytesseract is None:
        return [], 0.0, []
    try:
        if settings.tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
        with Image.open(BytesIO(content)) as image:
            gray = ImageOps.grayscale(image)
            if gray.width < 1200 and ImageEnhance is not None:
                ratio = min(2.0, 1200 / max(1, gray.width))
                gray = gray.resize(
                    (int(gray.width * ratio), int(gray.height * ratio)),
                    Image.Resampling.LANCZOS,
                )
            gray = ImageEnhance.Contrast(gray).enhance(1.7) if ImageEnhance else gray
            data = pytesseract.image_to_data(
                gray,
                config="--psm 6",
                output_type=pytesseract.Output.DICT,
                timeout=10,
            )
            lines_by_id: dict[tuple[int, int, int], list[str]] = {}
            confidences = []
            regions = []
            for index, (value, confidence) in enumerate(
                zip(data.get("text", []), data.get("conf", []))
            ):
                text = str(value).strip()
                try:
                    score = float(confidence)
                except (TypeError, ValueError):
                    continue
                if text and score >= 0:
                    line_key = (
                        int(data.get("block_num", [0] * (index + 1))[index]),
                        int(data.get("par_num", [0] * (index + 1))[index]),
                        int(data.get("line_num", list(range(index + 1)))[index]),
                    )
                    lines_by_id.setdefault(line_key, []).append(text)
                    confidences.append(score / 100)
                    left = int(data.get("left", [0] * (index + 1))[index])
                    top = int(data.get("top", [0] * (index + 1))[index])
                    width = int(data.get("width", [0] * (index + 1))[index])
                    height = int(data.get("height", [0] * (index + 1))[index])
                    regions.append(
                        {
                            "text": text,
                            "confidence": round(score / 100, 3),
                            "bounding_box": [
                                round(left / max(1, gray.width), 4),
                                round(top / max(1, gray.height), 4),
                                round(width / max(1, gray.width), 4),
                                round(height / max(1, gray.height), 4),
                            ],
                        }
                    )
            lines = [" ".join(words) for words in lines_by_id.values()]
            average_confidence = sum(confidences) / len(confidences) if confidences else 0.0
            return lines[:10], round(average_confidence, 3), regions[:100]
    except Exception as exc:
        logger.info("Tesseract OCR unavailable for image: %s", type(exc).__name__)
        return [], 0.0, []


def _overlapping_text_regions(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    overlaps = []
    for left_index, left in enumerate(regions):
        left_box = left.get("bounding_box", [])
        if len(left_box) != 4:
            continue
        lx, ly, lw, lh = left_box
        left_area = lw * lh
        for right in regions[left_index + 1 :]:
            right_box = right.get("bounding_box", [])
            if len(right_box) != 4:
                continue
            rx, ry, rw, rh = right_box
            intersection_width = max(0.0, min(lx + lw, rx + rw) - max(lx, rx))
            intersection_height = max(0.0, min(ly + lh, ry + rh) - max(ly, ry))
            intersection = intersection_width * intersection_height
            smaller_area = min(left_area, rw * rh)
            if smaller_area > 0 and intersection / smaller_area >= 0.3:
                overlaps.append({"first": left, "second": right})
    return overlaps


def _group_ocr_lines(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    words = sorted(
        (
            region
            for region in regions
            if len(region.get("bounding_box", [])) == 4
        ),
        key=lambda region: region["bounding_box"][1],
    )
    groups: list[list[dict[str, Any]]] = []
    for word in words:
        _, y, _, height = word["bounding_box"]
        center_y = y + height / 2
        matching_group = next(
            (
                group
                for group in groups
                if abs(
                    center_y
                    - sum(
                        item["bounding_box"][1] + item["bounding_box"][3] / 2
                        for item in group
                    )
                    / len(group)
                )
                <= max(0.012, height * 0.75)
            ),
            None,
        )
        if matching_group is None:
            groups.append([word])
        else:
            matching_group.append(word)

    lines = []
    for group in groups:
        group.sort(key=lambda word: word["bounding_box"][0])
        left = min(word["bounding_box"][0] for word in group)
        top = min(word["bounding_box"][1] for word in group)
        right = max(
            word["bounding_box"][0] + word["bounding_box"][2] for word in group
        )
        bottom = max(
            word["bounding_box"][1] + word["bounding_box"][3] for word in group
        )
        lines.append(
            {
                "text": " ".join(str(word.get("text", "")) for word in group),
                "confidence": round(
                    sum(float(word.get("confidence", 0)) for word in group)
                    / len(group),
                    3,
                ),
                "bounding_box": [
                    round(left, 4),
                    round(top, 4),
                    round(right - left, 4),
                    round(bottom - top, 4),
                ],
            }
        )
    return lines


def _text_layout_findings(
    regions: list[dict[str, Any]],
    source: str = "OCR",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lines = _group_ocr_lines(regions)
    findings = []
    reliable_lines = [line for line in lines if line["confidence"] >= 0.55]

    edge_lines = []
    for line in reliable_lines:
        x, y, width, height = line["bounding_box"]
        margin = min(x, y, 1 - x - width, 1 - y - height)
        if margin < 0.02:
            edge_lines.append({**line, "minimum_margin": round(margin, 4)})
    if edge_lines:
        findings.append(
            {
                "category": "layout",
                "severity": "medium",
                "description": "Recognized text is within 2% of the canvas edge; verify safe-area and crop requirements.",
                "detected_value": "; ".join(line["text"] for line in edge_lines[:3]),
                "confidence": round(
                    sum(line["confidence"] for line in edge_lines)
                    / len(edge_lines),
                    2,
                ),
                "recommended_correction": "Move the text inward or have a reviewer confirm the intended crop and safe area.",
                "verification_status": "needs_verification",
                "evidence": [
                    {
                        "method": f"{source} text-line bounds; minimum normalized margin < 0.02",
                        "text_lines": edge_lines[:10],
                    }
                ],
            }
        )

    if len(reliable_lines) >= 3:
        left_edges = [line["bounding_box"][0] for line in reliable_lines]
        baseline = sorted(left_edges)[len(left_edges) // 2]
        outliers = [
            line
            for line in reliable_lines
            if abs(line["bounding_box"][0] - baseline) >= 0.08
        ]
        if outliers:
            findings.append(
                {
                    "category": "layout",
                    "severity": "low",
                    "description": f"{source} text lines show a left-edge alignment outlier of at least 8% of canvas width; verify the intended layout.",
                    "detected_value": "; ".join(line["text"] for line in outliers[:3]),
                    "confidence": round(
                        sum(line["confidence"] for line in outliers)
                        / len(outliers),
                        2,
                    ),
                    "recommended_correction": "Compare text alignment with the approved layout or confirm that the offset is intentional.",
                    "verification_status": "needs_verification",
                    "evidence": [
                        {
                            "method": f"{source} line left-edge deviation threshold 0.08",
                            "baseline_left_edge": round(baseline, 4),
                            "outlier_lines": outliers[:10],
                        }
                    ],
                }
            )

        heights = [line["bounding_box"][3] for line in reliable_lines]
        minimum_height = min(heights)
        height_ratio = max(heights) / minimum_height if minimum_height else 0
        if height_ratio >= 2.5:
            findings.append(
                {
                    "category": "typography_analysis",
                    "severity": "low",
                    "description": "OCR text-line heights vary by at least 2.5×; verify hierarchy against the approved typography guidance.",
                    "detected_value": f"{height_ratio:.2f}x text-line height range",
                    "confidence": round(
                        sum(line["confidence"] for line in reliable_lines)
                        / len(reliable_lines),
                        2,
                    ),
                    "recommended_correction": "Review the text hierarchy against the approved typography system; OCR cannot identify font family.",
                    "verification_status": "needs_verification",
                    "evidence": [
                        {
                            "method": f"{source} normalized text-line height ratio threshold 2.5",
                            "height_ratio": round(height_ratio, 2),
                            "text_lines": reliable_lines[:20],
                        }
                    ],
                }
            )
    return lines, findings


def _approximate_typography(content: bytes) -> dict[str, Any]:
    if Image is None or ImageFilter is None:
        return {"font_family_estimate": "approximate", "text_density": 0.0, "layout": "unavailable"}
    try:
        with Image.open(BytesIO(content)) as image:
            gray = ImageOps.grayscale(image)
            edge = gray.filter(ImageFilter.FIND_EDGES)
            width, height = edge.size
            contrast = sum(edge.tobytes()) / max(1, width * height)
            rows = list(edge.resize((1, 100)).tobytes())
            active_rows = sum(1 for value in rows if value > 20)
            return {
                "font_family_estimate": "unidentified; font family requires a reference sample",
                "text_density": round(min(1.0, contrast / 255.0), 3),
                "layout": (
                    "multiple high-contrast rows detected"
                    if active_rows > 8 and contrast > 60
                    else "limited layout signal detected"
                ),
                "method": "edge-density heuristic",
                "confidence": 0.3,
            }
    except Exception:
        return {"font_family_estimate": "approximate", "text_density": 0.0, "layout": "unavailable"}


def _template_match_logo(image, reference) -> dict[str, Any]:
    best_score = -1.0
    best_box = None
    reference_height, reference_width = reference.shape[:2]
    for scale in (0.25, 0.35, 0.5, 0.65, 0.8, 1.0, 1.25, 1.5, 1.8, 2.2):
        width = int(reference_width * scale)
        height = int(reference_height * scale)
        if width < 12 or height < 12 or width > image.shape[1] or height > image.shape[0]:
            continue
        template = cv2.resize(reference, (width, height), interpolation=cv2.INTER_AREA)
        result = cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED)
        _, score, _, location = cv2.minMaxLoc(result)
        if score > best_score:
            best_score = float(score)
            best_box = [
                round(location[0] / image.shape[1], 4),
                round(location[1] / image.shape[0], 4),
                round(width / image.shape[1], 4),
                round(height / image.shape[0], 4),
            ]
    if best_score < 0:
        return {
            "status": "no_match",
            "similarity": 0.0,
            "method": "OpenCV multi-scale template matching",
        }
    return {
        "status": "matched" if best_score >= 0.88 else "partial" if best_score >= 0.55 else "no_match",
        "similarity": round(max(0.0, min(1.0, best_score)), 3),
        "method": "OpenCV multi-scale template matching",
        "bounding_box": best_box,
    }


def _match_logo_reference(
    content: bytes,
    reference_content: bytes,
) -> dict[str, Any]:
    if cv2 is None or np is None:
        return {
            "status": "unavailable",
            "similarity": 0.0,
            "method": "OpenCV ORB unavailable",
        }
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    reference = cv2.imdecode(
        np.frombuffer(reference_content, dtype=np.uint8), cv2.IMREAD_GRAYSCALE
    )
    if image is None or reference is None:
        return {"status": "unavailable", "similarity": 0.0, "method": "image decode"}

    border = np.concatenate(
        (reference[0, :], reference[-1, :], reference[:, 0], reference[:, -1])
    )
    background_level = int(np.median(border))
    foreground = cv2.threshold(
        cv2.absdiff(reference, np.full_like(reference, background_level)),
        18,
        255,
        cv2.THRESH_BINARY,
    )[1]
    points = cv2.findNonZero(foreground)
    if points is not None:
        x, y, width, height = cv2.boundingRect(points)
        if width >= 12 and height >= 12:
            reference = reference[y : y + height, x : x + width]

    detector = cv2.ORB_create(nfeatures=1200)
    reference_points, reference_descriptors = detector.detectAndCompute(reference, None)
    image_points, image_descriptors = detector.detectAndCompute(image, None)
    if (
        reference_descriptors is None
        or image_descriptors is None
        or len(reference_points) < 4
        or len(image_points) < 4
    ):
        return _template_match_logo(image, reference)

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    pairs = matcher.knnMatch(reference_descriptors, image_descriptors, k=2)
    good_matches = [
        pair[0]
        for pair in pairs
        if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance
    ]
    if len(good_matches) < 4:
        template_match = _template_match_logo(image, reference)
        template_match["orb_match_count"] = len(good_matches)
        return template_match

    source_points = np.float32(
        [reference_points[match.queryIdx].pt for match in good_matches]
    ).reshape(-1, 1, 2)
    target_points = np.float32(
        [image_points[match.trainIdx].pt for match in good_matches]
    ).reshape(-1, 1, 2)
    try:
        homography, inlier_mask = cv2.findHomography(
            source_points, target_points, cv2.RANSAC, 5.0
        )
    except cv2.error:
        homography, inlier_mask = None, None
    inlier_indices = (
        np.flatnonzero(inlier_mask.ravel()).tolist() if inlier_mask is not None else []
    )
    inlier_count = len(inlier_indices)
    inlier_ratio = inlier_count / len(good_matches)
    matched_reference_points = source_points[inlier_indices].reshape(-1, 2)
    reference_coverage = 0.0
    if len(matched_reference_points):
        x_span = float(np.ptp(matched_reference_points[:, 0])) / reference.shape[1]
        y_span = float(np.ptp(matched_reference_points[:, 1])) / reference.shape[0]
        reference_coverage = x_span * y_span

    bounding_box = None
    if homography is not None:
        corners = np.float32(
            [
                [0, 0],
                [reference.shape[1] - 1, 0],
                [reference.shape[1] - 1, reference.shape[0] - 1],
                [0, reference.shape[0] - 1],
            ]
        ).reshape(-1, 1, 2)
        projected = cv2.perspectiveTransform(corners, homography).reshape(-1, 2)
        left = max(0.0, float(projected[:, 0].min()) / image.shape[1])
        top = max(0.0, float(projected[:, 1].min()) / image.shape[0])
        right = min(1.0, float(projected[:, 0].max()) / image.shape[1])
        bottom = min(1.0, float(projected[:, 1].max()) / image.shape[0])
        if right > left and bottom > top:
            bounding_box = [
                round(left, 4),
                round(top, 4),
                round(right - left, 4),
                round(bottom - top, 4),
            ]

    similarity = round(
        0.65 * inlier_ratio + 0.35 * min(1.0, inlier_count / 12), 3
    )
    status = (
        "matched"
        if inlier_count >= 8 and inlier_ratio >= 0.5
        else "partial"
        if inlier_count >= 4
        else "no_match"
    )
    return {
        "status": status,
        "similarity": similarity,
        "method": "OpenCV ORB features with RANSAC homography",
        "match_count": len(good_matches),
        "inlier_count": inlier_count,
        "inlier_ratio": round(inlier_ratio, 3),
        "reference_coverage": round(reference_coverage, 3),
        "bounding_box": bounding_box,
    }


def analyze_visual_asset(
    filename: str,
    content: bytes,
    approved_colours: list[str] | None = None,
    approved_colour_references: dict[str, list[dict[str, Any]]] | None = None,
    logo_required: bool = False,
) -> dict[str, Any]:
    approved_colours = [color.lower() for color in (approved_colours or []) if isinstance(color, str) and color.strip()]
    image_dimensions = None
    dominant_colours = []
    ocr_text: list[str] = []
    ocr_confidence = 0.0
    ocr_regions: list[dict[str, Any]] = []
    warnings: list[str] = []
    typography = {"font_family_estimate": "approximate", "text_density": 0.0, "layout": "unavailable"}
    palette_regions: list[dict[str, Any]] = []
    aspect_ratio = None
    if Image is not None:
        try:
            with Image.open(BytesIO(content)) as image:
                image_dimensions = f"{image.width}x{image.height}"
                aspect_ratio = round(image.width / max(1, image.height), 4)
                dominant_colours = _dominant_colors(content)
                palette_regions = _dominant_color_regions(content)
                ocr_text, ocr_confidence, ocr_regions = _safe_ocr_text(content)
                typography = _approximate_typography(content)
        except Exception:
            image_dimensions = None
            dominant_colours = []
            ocr_text = []
            ocr_confidence = 0.0
            ocr_regions = []
            aspect_ratio = None
            typography = {"font_family_estimate": "approximate", "text_density": 0.0, "layout": "unavailable"}

    findings: list[dict[str, Any]] = []
    palette_check_skipped = bool(approved_colours) and _has_high_color_variation(content)
    if palette_check_skipped:
        warnings.append(
            "Palette deviation checks were skipped for this high-variation image to avoid flagging photographic colours; human verification is required."
        )
    colours_to_check = [] if palette_check_skipped else palette_regions
    for region in colours_to_check:
        color = region["color"]
        normalized = color.lower()
        closest = None
        closest_distance = None
        for candidate in approved_colours:
            candidate_rgb = _hex_to_rgb(candidate)
            normalized_rgb = _hex_to_rgb(normalized)
            distance = _color_distance(normalized_rgb, candidate_rgb)
            if closest_distance is None or distance < closest_distance:
                closest = candidate
                closest_distance = distance
        if not approved_colours or closest is None or closest_distance is None:
            continue
        tolerance = 25.0
        if closest_distance > tolerance:
            references = (approved_colour_references or {}).get(closest, [])
            findings.append({
                "id": f"visual-colour-{len(findings)}",
                "category": "brand_colour",
                "severity": "medium" if closest_distance > 50 else "low",
                "description": "A distinct design region differs perceptually from the approved brand palette.",
                "detected_value": color,
                "expected_brand_value": closest,
                "confidence": round(min(0.9, 0.65 + min(0.2, (closest_distance - tolerance) / 150) + min(0.05, region["area_fraction"])), 2),
                "recommended_correction": "Rebalance the creative to use a closer brand-approved colour.",
                "verification_status": "potential_violation",
                "evidence": [
                    {
                        "method": "connected palette region with CIELAB Delta E 76",
                        "detected_colour": color,
                        "reference_colour": closest,
                        "delta_e_76": round(closest_distance, 2),
                        "area_fraction": region["area_fraction"],
                        "bounding_box": region["bounding_box"],
                        "approved_guideline_references": references,
                    }
                ],
            })

    if ocr_text:
        text_heights = [
            region["bounding_box"][3]
            for region in ocr_regions
            if len(region.get("bounding_box", [])) == 4
            and region["bounding_box"][3] > 0
        ]
        typography["ocr_text_height_ratio"] = (
            round(max(text_heights) / min(text_heights), 2)
            if len(text_heights) > 1
            else None
        )
        typography["hierarchy_method"] = (
            "OCR bounding-box height ratio; does not identify font family"
        )
        findings.append(
            {
                "id": f"visual-ocr-{len(findings)}",
                "category": "typography_analysis",
                "severity": "low",
                "description": "OCR detected text fragments that may require consistency review against approved brand typography.",
                "detected_value": "; ".join(ocr_text[:3]),
                "expected_brand_value": "approved typography and messaging standard",
                "confidence": round(ocr_confidence, 2),
                "recommended_correction": "Review the typography hierarchy and ensure text matches the approved brand style guide.",
                "verification_status": "needs_verification",
                "evidence": [
                    {
                        "method": "OCR",
                        "recognized_text": ocr_text[:3],
                        "ocr_confidence": round(ocr_confidence, 2),
                        "bounding_boxes": ocr_regions[:20],
                    }
                ],
            }
        )
    text_overlaps = _overlapping_text_regions(ocr_regions)
    if text_overlaps:
        findings.append(
            {
                "id": f"visual-layout-{len(findings)}",
                "category": "layout",
                "severity": "medium",
                "description": "OCR text regions overlap substantially; verify that text remains legible.",
                "detected_value": "; ".join(
                    f"{pair['first']['text']} / {pair['second']['text']}"
                    for pair in text_overlaps[:3]
                ),
                "confidence": 0.7,
                "recommended_correction": "Adjust text placement to separate overlapping text regions.",
                "verification_status": "needs_verification",
                "evidence": [
                    {
                        "method": "OCR bounding-box intersection",
                        "overlapping_text_regions": text_overlaps[:10],
                    }
                ],
            }
        )
    text_line_regions, text_layout_findings = _text_layout_findings(ocr_regions)
    for finding in text_layout_findings:
        finding["id"] = f"visual-layout-{len(findings)}"
        findings.append(finding)

    summary = "Visual review completed with no obvious exceptions."
    if findings:
        summary = "Potential brand compliance issues were detected in the asset."
    return {
        "asset_id": None,
        "filename": filename,
        "logo_required": logo_required,
        "image_reference": None,
        "image_dimensions": image_dimensions,
        "dominant_colours": dominant_colours,
        "approved_colours": approved_colours,
        "palette_status": (
            "needs_verification"
            if palette_check_skipped
            else "checked"
            if approved_colours
            else "no_approved_palette"
        ),
        "warnings": warnings,
        "logo_matches": [],
        "ocr_text": ocr_text,
        "ocr_regions": ocr_regions,
        "typography_analysis": typography,
        "layout_analysis": {
            "aspect_ratio": aspect_ratio,
            "text_regions": ocr_regions,
            "text_line_regions": text_line_regions,
            "text_overlaps": text_overlaps,
            "text_minimum_margin": (
                round(
                    min(
                        min(region["bounding_box"][0], region["bounding_box"][1],
                            1 - region["bounding_box"][0] - region["bounding_box"][2],
                            1 - region["bounding_box"][1] - region["bounding_box"][3])
                        for region in ocr_regions
                        if len(region.get("bounding_box", [])) == 4
                    ),
                    4,
                )
                if ocr_regions
                else None
            ),
        },
        "findings": findings,
        "summary": summary,
    }


def analyze_visual_asset_with_providers(
    filename: str,
    content: bytes,
    media_type: str,
    approved_colours: list[str] | None = None,
    approved_colour_references: dict[str, list[dict[str, Any]]] | None = None,
    approved_references: list[dict[str, Any]] | None = None,
    logo_required: bool = False,
) -> dict[str, Any]:
    references = (approved_references or [])[:3]
    reference_palette_by_asset = {
        reference["id"]: _dominant_colors(reference["content"], max_colors=3)
        for reference in references
    }
    reference_palette = [
        color for colors in reference_palette_by_asset.values() for color in colors
    ]
    report = analyze_visual_asset(
        filename,
        content,
        approved_colours=approved_colours or reference_palette,
        approved_colour_references=approved_colour_references,
        logo_required=logo_required,
    )
    findings = report["findings"]
    for finding in findings:
        if finding.get("category") == "brand_colour":
            reference_colour = finding.get("expected_brand_value")
            finding["evidence"][0]["approved_reference_asset_ids"] = [
                asset_id
                for asset_id, colours in reference_palette_by_asset.items()
                if reference_colour in colours
            ]
    logo_matches = []
    warnings = list(report["warnings"])
    for reference in references:
        comparison = _match_logo_reference(content, reference["content"])
        logo_matches.append(
            {
                **comparison,
                "asset_id": reference["id"],
                "filename": reference["filename"],
            }
        )

    matched_logo = next(
        (item for item in logo_matches if item["status"] == "matched"), None
    )
    partial_logo = next(
        (item for item in logo_matches if item["status"] == "partial"), None
    )
    logo_finding = None
    if partial_logo:
        bounds = partial_logo.get("bounding_box")
        cropped_at_edge = bool(
            bounds
            and (
                bounds[0] <= 0.01
                or bounds[1] <= 0.01
                or bounds[0] + bounds[2] >= 0.99
                or bounds[1] + bounds[3] >= 0.99
            )
        )
        logo_finding = {
            "id": f"visual-logo-{len(findings)}",
            "category": "logo_integrity" if cropped_at_edge else "logo_variant",
            "severity": "medium",
            "description": (
                "A partial approved-logo match touches the canvas edge; possible cropping needs review."
                if cropped_at_edge
                else "A partial feature match may indicate a modified logo variant; verify it against the approved reference."
            ),
            "detected_value": filename,
            "expected_brand_value": partial_logo["filename"],
            "confidence": partial_logo["similarity"],
            "recommended_correction": "Compare the detected mark with the approved logo and check its placement and proportions.",
            "verification_status": "needs_verification",
            "evidence": [
                {
                    "method": partial_logo["method"],
                    "approved_asset_id": partial_logo["asset_id"],
                    "approved_reference_filename": partial_logo["filename"],
                    "feature_matches": partial_logo.get("match_count", 0),
                    "geometric_inliers": partial_logo.get("inlier_count", 0),
                    "reference_coverage": partial_logo.get("reference_coverage"),
                    "bounding_box": bounds,
                }
            ],
        }
    elif logo_required and not matched_logo:
        if references:
            logo_finding = {
                "id": f"visual-logo-{len(findings)}",
                "category": "logo_compliance",
                "severity": "medium",
                "description": "No approved logo reference could be matched in this creative; confirm whether the required logo is absent or not visually detectable.",
                "detected_value": filename,
                "expected_brand_value": ", ".join(
                    reference["filename"] for reference in references
                ),
                "confidence": 0.55,
                "recommended_correction": "Place an approved logo in the creative or have a reviewer verify an alternative lockup.",
                "verification_status": "needs_verification",
                "evidence": [
                    {
                        "method": "OpenCV ORB feature matching",
                        "approved_reference_asset_ids": [
                            reference["id"] for reference in references
                        ],
                        "reason": "No reference produced enough geometrically consistent features for a match.",
                    }
                ],
            }
        else:
            warnings.append(
                "A logo was marked required, but no approved logo reference image is available for comparison."
            )
            logo_finding = {
                "id": f"visual-logo-{len(findings)}",
                "category": "logo_compliance",
                "severity": "low",
                "description": "Logo presence cannot be verified because the organisation has no approved logo reference image.",
                "confidence": 0.0,
                "recommended_correction": "Approve a logo reference image before using automated logo checks.",
                "verification_status": "needs_verification",
                "evidence": [
                    {
                        "method": "configuration check",
                        "reason": "No approved logo reference was available; no visual absence claim was made.",
                    }
                ],
            }
    if logo_finding:
        findings.append(logo_finding)
    report["logo_matches"] = logo_matches

    vision_used_for_ocr = False
    vision_model = None
    vision_error_type = None
    vision_error_code = None
    vision_text_regions: list[dict[str, Any]] = []
    if pytesseract is None:
        ocr_status = "not_installed"
        warnings.append("Tesseract OCR is unavailable; image text checks use fallback analysis.")
    elif report["ocr_text"]:
        ocr_status = "available"
    else:
        ocr_status = "no_text_detected"
        try:
            pytesseract.get_tesseract_version()
        except Exception:
            ocr_status = "not_installed"
            warnings.append(
                "The pytesseract package is installed, but the Tesseract executable is unavailable; OCR was not run."
            )
    vision_status = "not_configured"
    if not settings.gemini_api_key:
        warnings.append("Gemini vision is not configured; heuristic visual findings are retained.")
    else:
        try:
            from app.ai.gemini import inspect_visual_with_gemini

            model_report = inspect_visual_with_gemini(
                content, media_type, references
            )
            vision_status = "available"
            vision_model = getattr(model_report, "_model_used", None)
            for observation in model_report.observations:
                if not observation.evidence.strip():
                    continue
                normalized_category = observation.category.strip().casefold()
                category_tokens = set(
                    normalized_category.replace("-", " ").replace("_", " ").split()
                )
                if category_tokens.intersection({"logo", "logos", "emblem"}):
                    category = "logo_compliance"
                elif category_tokens.intersection(
                    {"text", "textual", "wordmark", "tagline"}
                ):
                    category = "visible_text"
                elif category_tokens.intersection({"typography", "font"}):
                    category = "typography_analysis"
                elif category_tokens.intersection(
                    {"layout", "alignment", "composition"}
                ):
                    category = "layout"
                elif category_tokens.intersection({"colour", "color", "palette"}):
                    category = "brand_colour"
                else:
                    category = observation.category
                if category not in {
                    "logo_compliance",
                    "brand_colour",
                    "typography_analysis",
                    "layout",
                    "visible_text",
                }:
                    category = "visual_review"
                confidence = observation.confidence
                bounding_box = observation.bounding_box
                if bounding_box and (
                    len(bounding_box) != 4
                    or any(value < 0 or value > 1 for value in bounding_box)
                ):
                    bounding_box = None
                if (
                    category == "visible_text"
                    and observation.detected_value
                    and bounding_box
                    and all(0 <= value <= 1 for value in bounding_box)
                    and bounding_box[2] > 0
                    and bounding_box[3] > 0
                ):
                    vision_text_regions.append(
                        {
                            "text": observation.detected_value,
                            "confidence": confidence,
                            "bounding_box": bounding_box,
                        }
                    )
                evidence = [
                    {
                        "method": "Gemini vision-language model",
                        "observation": observation.evidence,
                        "bounding_box": bounding_box,
                    }
                ]
                findings.append(
                    {
                        "id": f"visual-model-{len(findings)}",
                        "category": category,
                        "severity": "medium" if confidence >= 0.85 else "low",
                        "description": observation.description,
                        "detected_value": observation.detected_value,
                        "expected_brand_value": observation.expected_brand_value,
                        "confidence": confidence,
                        "recommended_correction": "Review this visual observation against approved brand guidance.",
                        "verification_status": (
                            "potential_violation" if confidence >= 0.85 else "needs_verification"
                        ),
                        "evidence": evidence,
                    }
                )
            if model_report.recognized_text and not report["ocr_text"]:
                report["ocr_text"] = model_report.recognized_text
                vision_used_for_ocr = True
                if vision_text_regions:
                    vision_text_lines, vision_findings = _text_layout_findings(
                        vision_text_regions,
                        source="Gemini vision",
                    )
                    report["layout_analysis"]["vision_text_regions"] = (
                        vision_text_regions
                    )
                    report["layout_analysis"]["vision_text_line_regions"] = (
                        vision_text_lines
                    )
                    heights = [
                        region["bounding_box"][3]
                        for region in vision_text_lines
                        if region["bounding_box"][3] > 0
                    ]
                    report["typography_analysis"][
                        "vision_text_height_ratio"
                    ] = (
                        round(max(heights) / min(heights), 2)
                        if len(heights) > 1
                        else None
                    )
                    report["typography_analysis"][
                        "vision_text_hierarchy_method"
                    ] = (
                        "Gemini vision text-line bounds; does not identify font family"
                    )
                    for finding in vision_findings:
                        finding["id"] = f"visual-model-layout-{len(findings)}"
                        findings.append(finding)
            report["typography_analysis"]["vision_summary"] = model_report.typography_summary
            report["typography_analysis"]["layout_summary"] = model_report.layout_summary
        except Exception as exc:
            error_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            vision_error_type = type(exc).__name__
            vision_error_code = error_code if isinstance(error_code, int) else None
            logger.warning(
                "Gemini visual inspection unavailable error_type=%s status_code=%s",
                vision_error_type,
                vision_error_code,
            )
            vision_status = "unavailable"
            warnings.append(
                f"Gemini vision failed ({type(exc).__name__}); heuristic findings are retained."
            )
    if vision_used_for_ocr:
        ocr_status = "vision_model_text_recognition"
    report["provider_status"] = {
        "vision": vision_status,
        "vision_model": vision_model,
        "vision_error_type": vision_error_type,
        "vision_error_code": vision_error_code,
        "ocr": ocr_status,
        "logo_comparison": (
            "orb_feature_matching"
            if references and cv2 is not None
            else "unavailable"
            if references
            else "no_approved_reference"
        ),
    }
    report["warnings"] = warnings
    if findings:
        report["summary"] = "Potential visual findings require human review; no uncertain detection is a confirmed violation."
    else:
        report["summary"] = "Visual analysis completed with no findings above the configured detection thresholds."
    return report


def validate_image_upload(filename: str, content: bytes, max_size: int = settings.max_upload_size_bytes) -> None:
    if not is_supported_image(filename):
        raise ValueError("Unsupported image type.")
    if len(content) > max_size:
        raise ValueError("Image exceeds the configured size limit.")
    if len(content) == 0:
        raise ValueError("Image content is empty.")
    if Image is None:
        raise ValueError("Image processing is unavailable.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                image.verify()
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("Uploaded content is not a safe, valid image.") from exc
