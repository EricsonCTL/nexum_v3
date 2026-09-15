from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Any

from scripts.normalize_text import normalize_key

try:
    from rapidfuzz import fuzz, process
except ImportError:  # pragma: no cover - fallback for environments without optional dependency.
    fuzz = None
    process = None

OUTSIDE_CITIES = [
    "alhandra",
    "altiplano",
    "barra de camaratuba",
    "bessa",
    "caruaru",
    "joao pessoa",
    "intermares",
    "lucena",
    "lagoa seca",
    "cabedelo",
    "patos",
    "areia",
    "esperanca",
    "queimadas",
    "santa rita",
    "tibiri",
    "toritama",
    "valentina",
]


def load_location_dictionaries(base_dir: str | Path) -> dict[str, Any]:
    base = Path(base_dir)
    bairros = json.loads((base / "bairros_campina_grande.json").read_text(encoding="utf-8"))
    aliases = json.loads((base / "aliases_bairros.json").read_text(encoding="utf-8"))
    by_key = {normalize_key(item["bairro"]): item for item in bairros}
    alias_by_key = {normalize_key(key): value for key, value in aliases.items()}
    return {"bairros": bairros, "by_key": by_key, "aliases": alias_by_key}


def _best_fuzzy_match(text: str, keys: list[str]) -> tuple[str | None, float]:
    words = text.split()
    if len(words) > 40:
        return None, 0.0
    candidates: set[str] = set()
    for size in (1, 2, 3):
        for index in range(0, max(len(words) - size + 1, 0)):
            candidate = " ".join(words[index : index + size])
            if 4 <= len(candidate) <= 28:
                candidates.add(candidate)

    if process and fuzz:
        best_key = None
        best_score = 0.0
        for candidate in candidates:
            match = process.extractOne(candidate, keys, scorer=fuzz.ratio, score_cutoff=91)
            if match and match[1] > best_score:
                best_key = match[0]
                best_score = match[1]
        return best_key, best_score / 100

    best_key = None
    best_score = 0.0
    for candidate in candidates:
        for key in keys:
            score = difflib.SequenceMatcher(None, candidate, key).ratio()
            if score > best_score:
                best_score = score
                best_key = key
    return best_key, best_score


def extract_location(text: str, dictionaries: dict[str, Any]) -> dict[str, object]:
    normalized = normalize_key(text)
    outside = any(city in normalized for city in OUTSIDE_CITIES)

    for alias_key, bairro_name in dictionaries["aliases"].items():
        if f" {alias_key} " in f" {normalized} ":
            bairro = dictionaries["by_key"].get(normalize_key(bairro_name))
            if bairro:
                return _location_result(alias_key, bairro, outside, 0.92)

    for key, bairro in dictionaries["by_key"].items():
        if f" {key} " in f" {normalized} ":
            return _location_result(key, bairro, outside, 0.9)

    return {
        "cidade_detectada": "Fora do recorte" if outside else None,
        "bairro_original": None,
        "bairro_normalizado": None,
        "bairro_id": None,
        "regiao": None,
        "zona": None,
        "latitude": None,
        "longitude": None,
        "localizacao_confianca": 0.0,
        "fora_campina_grande_flag": outside,
    }


def _location_result(original: str, bairro: dict[str, Any], outside: bool, confidence: float) -> dict[str, object]:
    return {
        "cidade_detectada": "Campina Grande",
        "bairro_original": original,
        "bairro_normalizado": bairro["bairro"],
        "bairro_id": normalize_key(bairro["bairro"]).replace(" ", "_"),
        "regiao": bairro["regiao"],
        "zona": bairro["zona"],
        "latitude": bairro["latitude"],
        "longitude": bairro["longitude"],
        "localizacao_confianca": confidence,
        "fora_campina_grande_flag": outside,
    }
