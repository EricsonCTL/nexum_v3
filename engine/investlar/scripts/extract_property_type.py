from __future__ import annotations

import json
from pathlib import Path

from scripts.normalize_text import normalize_key


def load_property_terms(dictionary_path: str | Path) -> list[dict[str, object]]:
    items = json.loads(Path(dictionary_path).read_text(encoding="utf-8"))
    for item in items:
        item["termos_normalizados"] = [normalize_key(str(term)) for term in item.get("termos", [])]
    return items


def extract_property_type(text: str, property_terms: list[dict[str, object]]) -> dict[str, object]:
    normalized = f" {normalize_key(text)} "
    for item in property_terms:
        for term_key in item.get("termos_normalizados", []):
            if f" {term_key} " in normalized:
                return {
                    "tipo_imovel": item["tipo_imovel"],
                    "segmento_imovel": item["segmento_imovel"],
                    "confianca_tipo_imovel": 0.9,
                }
    return {
        "tipo_imovel": "INDEFINIDO",
        "segmento_imovel": "INDEFINIDO",
        "confianca_tipo_imovel": 0.2,
    }
