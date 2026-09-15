from __future__ import annotations

import re

from scripts.normalize_text import normalize_key


def _first_int(patterns: list[str], text: str) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                return int(match.group(1))
            except (TypeError, ValueError):
                return None
    return None


def _first_float(patterns: list[str], text: str) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(1).replace(".", "").replace(",", ".")
            try:
                return float(value)
            except ValueError:
                return None
    return None


def extract_features(text: str) -> dict[str, object]:
    normalized = normalize_key(text)
    original = text or ""

    quartos = _first_int(
        [
            r"\b(\d{1,2})\s*/\s*4\b",
            r"\b(\d{1,2})\s*(?:quartos|qtos|qts|dormitorios|dorms)\b",
        ],
        normalized,
    )
    suites = _first_int(
        [
            r"\b(\d{1,2})\s*(?:suites|suite)\b",
            r"\bsendo\s+(\d{1,2})\s*(?:suite|suites)\b",
        ],
        normalized,
    )
    banheiros = _first_int([r"\b(\d{1,2})\s*(?:banheiros|banheiro|wc|wcb)\b"], normalized)
    vagas = _first_int([r"\b(\d{1,2})\s*(?:vagas|vaga)\b"], normalized)
    andar = _first_int([r"\b(\d{1,2})\s*(?:andar)\b"], normalized)
    area = _first_float(
        [
            r"\b(\d{1,4}(?:[,.]\d{1,2})?)\s*(?:m2|m²|metros)\b",
            r"\barea\s+(?:privativa|terreno)?\s*(\d{1,4}(?:[,.]\d{1,2})?)\b",
        ],
        original.lower(),
    )

    return {
        "area_privativa_m2": area,
        "area_terreno_m2": None,
        "quartos": quartos,
        "suites": suites,
        "banheiros": banheiros,
        "vagas_garagem": vagas,
        "andar": andar,
        "mobiliado_flag": "mobiliado" in normalized and "semi mobiliado" not in normalized,
        "semi_mobiliado_flag": any(term in normalized for term in ("semi mobiliado", "semi-mobiliado", "semimobiliado")),
        "elevador_flag": "elevador" in normalized,
        "area_lazer_flag": any(term in normalized for term in ("area de lazer", "lazer", "salao de festas", "academia")),
        "piscina_flag": "piscina" in normalized,
        "condominio_incluso_flag": any(term in normalized for term in ("condominio incluso", "incluso condominio", "ja incluso")),
        "financiavel_flag": any(term in normalized for term in ("financiavel", "financia", "aceita financiamento")),
        "aceita_permuta_flag": any(term in normalized for term in ("permuta", "aceita troca")),
        "nascente_flag": any(term in normalized for term in ("nascente", "sombra")),
    }
