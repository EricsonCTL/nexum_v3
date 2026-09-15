from __future__ import annotations

import hashlib
from typing import Any

from scripts.normalize_text import normalize_key


def dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []

    for record in records:
        key = _dedupe_key(record)
        if key in seen:
            seen[key]["duplicate_count"] = int(seen[key].get("duplicate_count", 1)) + 1
            continue
        record["duplicate_count"] = 1
        record["dedupe_key"] = key
        seen[key] = record
        ordered.append(record)

    return ordered


def _dedupe_key(record: dict[str, Any]) -> str:
    principal_value = (
        record.get("valor_venda")
        or record.get("valor_locacao")
        or record.get("valor_repasse_agio")
        or record.get("valor_orcamento_maximo")
        or ""
    )
    parts = [
        str(record.get("sender_id") or ""),
        str(record.get("date") or ""),
        str(record.get("bairro_normalizado") or ""),
        str(record.get("tipo_imovel") or ""),
        str(principal_value),
        normalize_key(str(record.get("texto_original") or ""))[:240],
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]
