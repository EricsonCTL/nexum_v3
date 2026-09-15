from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Iterable


PHONE_RE = re.compile(r"(?:(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?)?(?:9\s*)?\d{4}[-\s]?\d{4}")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
HIDDEN_MEDIA_RE = re.compile(r"<\s*M[ií]dia\s+oculta\s*>", re.IGNORECASE)
FULL_NAME_RE = re.compile(
    r"\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,})\s+"
    r"([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,})(?:\s+"
    r"[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,})?\b"
)

KEEP_SYMBOLS = {"²", "º", "ª"}


def strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text or "")
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def strip_emoji(text: str) -> str:
    chars: list[str] = []
    for char in text or "":
        category = unicodedata.category(char)
        if char in KEEP_SYMBOLS:
            chars.append(char)
        elif category.startswith("So") or category.startswith("Cs"):
            chars.append(" ")
        else:
            chars.append(char)
    return "".join(chars)


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


@lru_cache(maxsize=50000)
def normalize_key(text: str) -> str:
    text = strip_emoji(strip_accents(text or "")).lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return normalize_whitespace(text)


def normalize_text(text: str) -> dict[str, object]:
    sem_emoji = strip_emoji(text or "")
    sem_acentos = strip_accents(sem_emoji)
    lower = sem_emoji.lower()
    normalizado = normalize_key(sem_emoji)
    return {
        "texto_original": text or "",
        "texto_lower": lower,
        "texto_sem_acentos": sem_acentos,
        "texto_sem_emoji": sem_emoji,
        "texto_normalizado": normalizado,
        "tokens": normalizado.split(),
    }


def contains_any(text_normalized: str, terms: Iterable[str]) -> bool:
    haystack = f" {normalize_key(text_normalized)} "
    return any(f" {normalize_key(term)} " in haystack for term in terms)


def mask_private_text(text: str, max_chars: int = 360) -> str:
    masked = URL_RE.sub("[link]", text or "")
    masked = HIDDEN_MEDIA_RE.sub(" ", masked)
    masked = EMAIL_RE.sub("[email]", masked)
    masked = PHONE_RE.sub("[telefone]", masked)
    masked = FULL_NAME_RE.sub("[nome]", masked)
    masked = normalize_whitespace(masked)
    if len(masked) > max_chars:
        return masked[: max_chars - 3].rstrip() + "..."
    return masked


def stable_text_hash(text: str) -> str:
    return normalize_key(text).replace(" ", "")
