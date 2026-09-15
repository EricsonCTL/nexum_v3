from __future__ import annotations

from typing import Any


def score_record(record: dict[str, Any], intent_ambiguous: bool = False) -> dict[str, Any]:
    intent_score = float(record.get("confianca_intencao") or 0)
    type_score = float(record.get("confianca_tipo_imovel") or 0)
    bairro_score = float(record.get("localizacao_confianca") or 0)
    value_score = float(record.get("valor_confianca") or 0)

    record["confianca_bairro"] = bairro_score
    record["confianca_valor"] = value_score
    record["confianca_area"] = 0.75 if record.get("area_privativa_m2") or record.get("area_terreno_m2") else 0.0
    record["confianca_total"] = round(
        (intent_score * 0.34) + (type_score * 0.22) + (max(bairro_score, value_score) * 0.3) + (value_score * 0.14),
        2,
    )

    intent = record.get("intencao_mercado")
    has_anchor = bool(record.get("bairro_normalizado") or record.get("valor_venda") or record.get("valor_locacao") or record.get("valor_orcamento_maximo"))
    has_type = record.get("tipo_imovel") != "INDEFINIDO"

    if intent == "RUIDO":
        status = "RUIDO"
    elif intent_ambiguous or record.get("valor_ambiguidade_flag"):
        status = "AMBIGUO"
    elif intent == "INDEFINIDA":
        status = "REVISAO_MANUAL" if has_anchor or has_type else "RUIDO"
    elif has_anchor and has_type and record["confianca_total"] >= 0.65:
        status = "VALIDO"
    else:
        status = "PARCIAL"

    record["status_extracao"] = status
    return record
