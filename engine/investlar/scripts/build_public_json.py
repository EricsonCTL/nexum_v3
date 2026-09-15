from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from scripts.normalize_text import mask_private_text


SALE_SUPPLY_OPS = {"venda_ofertada", "repasse"}
RENT_SUPPLY_OPS = {"locacao_ofertada"}
DEMAND_OPS = {"compra_procurada", "locacao_procurada"}
SUPPLY_OPS = SALE_SUPPLY_OPS | RENT_SUPPLY_OPS


PUBLIC_OPPORTUNITY_FIELDS = [
    "id",
    "batch_id",
    "data_inicio",
    "data_fim",
    "sender_id",
    "operacao_mercado",
    "operacao_label",
    "intencao_mercado",
    "lado_negociacao",
    "tipo_imovel",
    "segmento_imovel",
    "tipo_imovel_fisico",
    "segmento_uso",
    "padrao_economico",
    "mcmv_indicio",
    "mcmv_possivel",
    "faixa_valor",
    "valor_m2_estimado",
    "confidence_padrao",
    "status_padrao",
    "tier_mercado",
    "cidade_detectada",
    "bairro_original",
    "bairro_normalizado",
    "bairro_id",
    "regiao",
    "zona",
    "latitude",
    "longitude",
    "valor_venda",
    "valor_locacao",
    "valor_condominio",
    "valor_iptu",
    "valor_entrada",
    "valor_saldo",
    "valor_parcela",
    "valor_repasse_agio",
    "valor_orcamento_maximo",
    "valor_orcamento_minimo",
    "area_privativa_m2",
    "area_terreno_m2",
    "quartos",
    "suites",
    "banheiros",
    "vagas_garagem",
    "andar",
    "mobiliado_flag",
    "semi_mobiliado_flag",
    "elevador_flag",
    "area_lazer_flag",
    "piscina_flag",
    "condominio_incluso_flag",
    "financiavel_flag",
    "aceita_permuta_flag",
    "nascente_flag",
    "tem_midia",
    "media_count",
    "fora_campina_grande_flag",
    "confianca_intencao",
    "confianca_tipo_imovel",
    "confianca_bairro",
    "confianca_valor",
    "confianca_area",
    "confianca_total",
    "status_extracao",
    "duplicate_count",
]


def write_public_jsons(
    records: list[dict[str, Any]],
    output_dir: str | Path,
    manifest: dict[str, Any],
    sender_directory: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    opportunities = [_public_opportunity(record) for record in records if record.get("status_extracao") != "RUIDO"]
    kpis = build_kpis(records)
    bairros_summary = build_bairros_summary(opportunities)
    heatmap = build_heatmap(bairros_summary)
    time_series = build_time_series(opportunities)
    directory = build_sender_directory(sender_directory or [], records)
    senders = build_senders_summary(records, directory)
    broker_messages = build_broker_messages([record for record in records if record.get("status_extracao") != "RUIDO"])
    quality = build_quality(records)
    samples = build_samples_review(records)

    manifest = {
        **manifest,
        "total_blocks": len(records),
        "total_opportunities": len(opportunities),
        "total_valid_opportunities": sum(1 for item in records if item.get("status_extracao") == "VALIDO"),
    }

    files = {
        "manifest.json": manifest,
        "kpis.json": kpis,
        "opportunities.json": opportunities,
        "bairros_summary.json": bairros_summary,
        "heatmap_bairros.json": heatmap,
        "time_series.json": time_series,
        "senders_summary.json": senders,
        "sender_directory.json": directory,
        "broker_messages.json": broker_messages,
        "extraction_quality.json": quality,
        "samples_review.json": samples,
    }
    for filename, payload in files.items():
        _write_json(output / filename, payload)
    return {"files": list(files), "manifest": manifest, "kpis": kpis, "quality": quality}


def build_kpis(records: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(records)
    non_noise = [item for item in records if item.get("status_extracao") != "RUIDO"]
    in_scope = [item for item in non_noise if not item.get("fora_campina_grande_flag")]
    ticket_scope = [item for item in in_scope if item.get("status_extracao") in {"VALIDO", "PARCIAL"}]
    valid = [item for item in records if item.get("status_extracao") == "VALIDO"]
    sale_values = [float(item["valor_venda"]) for item in ticket_scope if item.get("valor_venda")]
    rent_values = [float(item["valor_locacao"]) for item in ticket_scope if item.get("valor_locacao")]
    with_bairro = sum(1 for item in non_noise if item.get("bairro_normalizado"))
    with_value = sum(1 for item in non_noise if _principal_value(item) is not None)
    return {
        "total_blocos": total,
        "total_oportunidades_validas": len(valid),
        "percentual_ruido": _pct(sum(1 for item in records if item.get("status_extracao") == "RUIDO"), total),
        "percentual_com_bairro": _pct(with_bairro, len(non_noise)),
        "percentual_com_valor": _pct(with_value, len(non_noise)),
        "total_oferta": sum(1 for item in non_noise if item.get("operacao_mercado") in SUPPLY_OPS),
        "total_demanda": sum(1 for item in non_noise if item.get("operacao_mercado") in DEMAND_OPS),
        "total_compra": sum(1 for item in non_noise if item.get("operacao_mercado") == "compra_procurada"),
        "total_venda_operacao": sum(1 for item in non_noise if item.get("operacao_mercado") == "venda_ofertada"),
        "total_locador": sum(1 for item in non_noise if item.get("operacao_mercado") == "locacao_ofertada"),
        "total_locatario": sum(1 for item in non_noise if item.get("operacao_mercado") == "locacao_procurada"),
        "total_repasse": sum(1 for item in non_noise if item.get("operacao_mercado") == "repasse"),
        "total_permuta": sum(1 for item in non_noise if item.get("operacao_mercado") == "permuta"),
        "total_venda": sum(1 for item in non_noise if "VENDA" in str(item.get("intencao_mercado")) or item.get("valor_venda")),
        "total_locacao": sum(1 for item in non_noise if "LOCACAO" in str(item.get("intencao_mercado")) or item.get("valor_locacao")),
        "ticket_medio_venda": round(sum(sale_values) / len(sale_values), 2) if sale_values else 0,
        "ticket_medio_locacao": round(sum(rent_values) / len(rent_values), 2) if rent_values else 0,
    }


def build_bairros_summary(opportunities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in opportunities:
        if item.get("bairro_normalizado") and not item.get("fora_campina_grande_flag"):
            grouped[str(item["bairro_normalizado"])].append(item)

    rows: list[dict[str, Any]] = []
    for bairro, items in grouped.items():
        sale_values = [float(item["valor_venda"]) for item in items if item.get("valor_venda")]
        rent_values = [float(item["valor_locacao"]) for item in items if item.get("valor_locacao")]
        oferta = sum(1 for item in items if item.get("operacao_mercado") in SUPPLY_OPS)
        demanda = sum(1 for item in items if item.get("operacao_mercado") in DEMAND_OPS)
        first = items[0]
        rows.append(
            {
                "bairro": bairro,
                "regiao": first.get("regiao"),
                "zona": first.get("zona"),
                "total": len(items),
                "oferta": oferta,
                "demanda": demanda,
                "venda": sum(1 for item in items if "VENDA" in str(item.get("intencao_mercado")) or item.get("valor_venda")),
                "locacao": sum(1 for item in items if "LOCACAO" in str(item.get("intencao_mercado")) or item.get("valor_locacao")),
                "ticket_medio_venda": round(sum(sale_values) / len(sale_values), 2) if sale_values else 0,
                "ticket_medio_locacao": round(sum(rent_values) / len(rent_values), 2) if rent_values else 0,
                "pressao_demanda": round(demanda / max(oferta, 1), 2),
                "latitude": first.get("latitude"),
                "longitude": first.get("longitude"),
            }
        )
    return sorted(rows, key=lambda item: item["total"], reverse=True)


def build_heatmap(bairros_summary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    max_total = max((item["total"] for item in bairros_summary), default=1)
    return [
        {
            "bairro": item["bairro"],
            "regiao": item.get("regiao"),
            "latitude": item.get("latitude"),
            "longitude": item.get("longitude"),
            "intensidade": round(item["total"] / max_total, 3),
            "total": item["total"],
            "oferta": item["oferta"],
            "demanda": item["demanda"],
            "ticket_medio_venda": item["ticket_medio_venda"],
            "ticket_medio_locacao": item["ticket_medio_locacao"],
            "pressao_demanda": item["pressao_demanda"],
        }
        for item in bairros_summary
        if item.get("latitude") and item.get("longitude")
    ]


def build_time_series(opportunities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, Counter[str]] = defaultdict(Counter)
    for item in opportunities:
        period = str(item.get("data_inicio", ""))[:7]
        if not period:
            continue
        grouped[period]["total"] += 1
        grouped[period][str(item.get("operacao_mercado") or "indefinida").lower()] += 1
        grouped[period][str(item.get("intencao_mercado") or "INDEFINIDA").lower()] += 1
    return [{"period": period, **dict(counter)} for period, counter in sorted(grouped.items())]


def build_sender_directory(sender_directory: list[dict[str, Any]], records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_sender = {item.get("sender_id"): dict(item) for item in sender_directory if item.get("sender_id")}
    for item in records:
        sender_id = item.get("sender_id")
        if not sender_id:
            continue
        by_sender.setdefault(
            sender_id,
            {
                "sender_id": sender_id,
                "raw_sender": None,
                "nome_corretor": item.get("nome_corretor") or sender_id,
                "telefone_corretor": item.get("telefone_corretor") or "",
                "fonte_nome": "record",
            },
        )
    return sorted(by_sender.values(), key=lambda item: str(item.get("sender_id") or ""))


def build_senders_summary(records: list[dict[str, Any]], sender_directory: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in records:
        if item.get("sender_id"):
            grouped[str(item["sender_id"])].append(item)

    rows: list[dict[str, Any]] = []
    for sender_id, items in grouped.items():
        intents = Counter(str(item.get("intencao_mercado")) for item in items)
        non_noise = [item for item in items if item.get("status_extracao") != "RUIDO"]
        rows.append(
            {
                "sender_id": sender_id,
                "total_blocos": len(items),
                "total_oportunidades": len(non_noise),
                "oferta": sum(1 for item in non_noise if item.get("operacao_mercado") in SUPPLY_OPS),
                "demanda": sum(1 for item in non_noise if item.get("operacao_mercado") in DEMAND_OPS),
                "intencao_principal": intents.most_common(1)[0][0] if intents else "INDEFINIDA",
                "confianca_media": round(sum(float(item.get("confianca_total") or 0) for item in items) / len(items), 2),
            }
        )
    return sorted(rows, key=lambda item: item["total_oportunidades"], reverse=True)


def build_broker_messages(opportunities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in opportunities:
        if not item.get("sender_id"):
            continue
        rows.append(
            {
                "id": item.get("id"),
                "data_inicio": item.get("data_inicio"),
                "data_fim": item.get("data_fim"),
                "sender_id": item.get("sender_id"),
                "nome_corretor": item.get("nome_corretor") or item.get("sender_id"),
                "telefone_corretor": item.get("telefone_corretor") or "",
                "operacao_mercado": item.get("operacao_mercado"),
                "intencao_mercado": item.get("intencao_mercado"),
                "tipo_imovel": item.get("tipo_imovel"),
                "bairro_normalizado": item.get("bairro_normalizado"),
                "status_extracao": item.get("status_extracao"),
                "confianca_total": item.get("confianca_total"),
                "texto_mascarado": mask_private_text(str(item.get("texto_original") or "")),
            }
        )
    return rows


def build_quality(records: list[dict[str, Any]]) -> dict[str, int]:
    statuses = Counter(str(item.get("status_extracao")) for item in records)
    return {
        "validos": statuses["VALIDO"],
        "parciais": statuses["PARCIAL"],
        "ruido": statuses["RUIDO"],
        "ambiguos": statuses["AMBIGUO"],
        "revisao_manual": statuses["REVISAO_MANUAL"],
        "sem_bairro": sum(1 for item in records if item.get("status_extracao") != "RUIDO" and not item.get("bairro_normalizado")),
        "sem_valor": sum(1 for item in records if item.get("status_extracao") != "RUIDO" and _principal_value(item) is None),
        "fora_campina_grande": sum(1 for item in records if item.get("fora_campina_grande_flag")),
    }


def build_samples_review(records: list[dict[str, Any]], limit: int = 120) -> list[dict[str, Any]]:
    priority = {"AMBIGUO": 0, "REVISAO_MANUAL": 1, "PARCIAL": 2, "VALIDO": 3}
    candidates = [
        item
        for item in records
        if item.get("status_extracao") in {"AMBIGUO", "REVISAO_MANUAL", "PARCIAL", "VALIDO"}
    ]
    candidates.sort(key=lambda item: (priority.get(str(item.get("status_extracao")), 9), -(float(item.get("confianca_total") or 0))))
    return [
        {
            "id": item.get("id"),
            "data_inicio": item.get("data_inicio"),
            "sender_id": item.get("sender_id"),
            "intencao_mercado": item.get("intencao_mercado"),
            "status_extracao": item.get("status_extracao"),
            "confianca_total": item.get("confianca_total"),
            "bairro_normalizado": item.get("bairro_normalizado"),
            "valor_principal": _principal_value(item),
            "texto_mascarado": mask_private_text(str(item.get("texto_original") or "")),
        }
        for item in candidates[:limit]
    ]


def _public_opportunity(record: dict[str, Any]) -> dict[str, Any]:
    return {field: record.get(field) for field in PUBLIC_OPPORTUNITY_FIELDS}


def _principal_value(item: dict[str, Any]) -> Any:
    return (
        item.get("valor_venda")
        or item.get("valor_locacao")
        or item.get("valor_repasse_agio")
        or item.get("valor_orcamento_maximo")
    )


def _pct(value: int, total: int) -> float:
    return round((value / total) * 100, 2) if total else 0.0


def _write_json(path: Path, payload: Any) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default), encoding="utf-8")
    temp_path.replace(path)


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)
