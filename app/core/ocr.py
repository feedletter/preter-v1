"""Google Cloud Vision으로 명함 이미지에서 텍스트를 추출하고, 휴리스틱으로 필드를 분리한다.

Vision API는 "이건 이름이고 이건 직책이다" 같은 의미 구조를 모르고 텍스트/좌표만 준다.
그래서 명함의 일반적인 인쇄 관례(이름은 가장 큰 글자, 직책은 정해진 단어 목록과 일치)에
기대어 분리한다 — 완벽하지 않을 수 있으므로 회원가입 폼에서 항상 사용자가 직접 고칠 수 있게
한다(그래서 정확도보다 "그럴듯한 초기값"을 빠르게 주는 것이 이 모듈의 목표).
"""

import re
from dataclasses import dataclass, field

from google.cloud import vision

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}")

# 직책으로 흔히 쓰이는 단어 — 이 목록과 일치하는 줄을 position으로 채택한다.
POSITION_KEYWORDS = [
    "대표",
    "대표이사",
    "사장",
    "부사장",
    "전무",
    "상무",
    "이사",
    "본부장",
    "부장",
    "차장",
    "과장",
    "대리",
    "주임",
    "사원",
    "팀장",
    "매니저",
    "manager",
    "director",
    "president",
    "ceo",
    "cto",
    "cfo",
    "coo",
    "vp",
    "vice president",
    "founder",
    "lead",
]

# 회사명에 흔히 붙는 토큰 — 이 토큰을 포함한 줄을 company_name으로 채택한다.
COMPANY_TOKENS = ["(주)", "㈜", "주식회사", "co.,", "co.", "corp", "inc", "ltd", "company", "group"]


@dataclass
class ParsedBusinessCard:
    raw_text: str
    name: str | None = None
    company_email: str | None = None
    phone: str | None = None
    company_name: str | None = None
    position: str | None = None
    confidence: float | None = None
    detected_lines: list[str] = field(default_factory=list)


class OcrError(Exception):
    pass


def parse_business_card(image_content: bytes) -> ParsedBusinessCard:
    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_content)

    response = client.document_text_detection(image=image)
    if response.error.message:
        raise OcrError(response.error.message)

    annotation = response.full_text_annotation
    raw_text = annotation.text or ""
    if not raw_text.strip():
        return ParsedBusinessCard(raw_text="")

    lines = _extract_lines_with_height(annotation)
    detected_lines = [text for text, _height in lines]

    email_match = EMAIL_RE.search(raw_text)
    phone_match = _find_phone(detected_lines)

    name = _pick_name(lines)
    position = _pick_position(detected_lines)
    company_name = _pick_company_name(detected_lines, exclude={name})

    confidence = _average_page_confidence(annotation)

    return ParsedBusinessCard(
        raw_text=raw_text,
        name=name,
        company_email=email_match.group(0) if email_match else None,
        phone=phone_match,
        company_name=company_name,
        position=position,
        confidence=confidence,
        detected_lines=detected_lines,
    )


def _extract_lines_with_height(annotation) -> list[tuple[str, float]]:
    """페이지 구조(block > paragraph > word)를 줄 단위 텍스트 + 평균 글자 높이로 펼친다."""
    lines: list[tuple[str, float]] = []
    for page in annotation.pages:
        for block in page.blocks:
            for paragraph in block.paragraphs:
                words = []
                heights = []
                for word in paragraph.words:
                    word_text = "".join(symbol.text for symbol in word.symbols)
                    words.append(word_text)
                    vertices = word.bounding_box.vertices
                    if len(vertices) >= 3:
                        heights.append(abs(vertices[2].y - vertices[0].y))
                line_text = " ".join(words).strip()
                if not line_text:
                    continue
                avg_height = sum(heights) / len(heights) if heights else 0.0
                lines.append((line_text, avg_height))
    return lines


def _pick_name(lines: list[tuple[str, float]]) -> str | None:
    """이메일/전화/URL이 아닌 줄 중 글자가 가장 큰(=명함에서 보통 이름) 줄을 고른다."""
    candidates = [
        (text, height)
        for text, height in lines
        if not EMAIL_RE.search(text) and not PHONE_RE.search(text) and "http" not in text.lower()
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[1])[0]


def _pick_position(detected_lines: list[str]) -> str | None:
    for line in detected_lines:
        lowered = line.lower()
        if any(keyword in lowered for keyword in POSITION_KEYWORDS):
            return line
    return None


def _pick_company_name(detected_lines: list[str], exclude: set[str | None]) -> str | None:
    for line in detected_lines:
        if line in exclude:
            continue
        lowered = line.lower()
        if any(token in lowered for token in COMPANY_TOKENS):
            return line
    return None


def _find_phone(detected_lines: list[str]) -> str | None:
    for line in detected_lines:
        match = PHONE_RE.search(line)
        if match:
            digits = re.sub(r"\D", "", match.group(0))
            if len(digits) >= 9:  # 너무 짧은 숫자열(우편번호 등) 오탐 방지
                return match.group(0)
    return None


def _average_page_confidence(annotation) -> float | None:
    confidences = [page.confidence for page in annotation.pages if page.confidence]
    if not confidences:
        return None
    return sum(confidences) / len(confidences)
