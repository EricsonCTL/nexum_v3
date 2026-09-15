from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scripts.normalize_text import normalize_key


TYPE_MAP = {
    "APARTAMENTO": "apartamento",
    "CASA": "casa",
    "TERRENO_LOTE": "lote",
    "GALPAO": "galpao",
    "SALA_COMERCIAL": "sala_comercial",
    "PONTO_COMERCIAL": "ponto_comercial",
    "PREDIO_COMERCIAL": "predio_comercial",
    "SITIO_CHACARA_FAZENDA": "sitio",
    "KITNET_FLAT_STUDIO": "studio",
    "INDEFINIDO": "indefinido",
    None: "indefinido",
}

COMMERCIAL_TYPES = {"galpao", "sala_comercial", "ponto_comercial", "predio_comercial"}
RURAL_TYPES = {"chacara", "sitio"}
LOT_TYPES = {"lote", "terreno"}
RESIDENTIAL_TYPES = {"casa", "apartamento", "flat", "studio", "kitnet", "lote", "terreno"}


def load_economic_dictionaries(base_dir: str | Path = "dictionaries") -> dict[str, Any]:
    base = Path(base_dir)
    return {
        "mcmv_keywords": _load_jsonish(base / "keywords_mcmv.yml")["keywords"],
        "premium_keywords": _load_jsonish(base / "keywords_premium.yml")["keywords"],
        "bairro_tiers": _invert_tiers(_load_jsonish(base / "bairros_campina_grande.yml")["tiers"]),
        "rules": _load_jsonish(base / "padroes_economicos.yml"),
    }


def classificar_padrao_imovel(bloco: dict[str, Any], dictionaries: dict[str, Any] | None = None) -> dict[str, Any]:
    dictionaries = dictionaries or load_economic_dictionaries()
    text = normalize_key(str(bloco.get("texto_normalizado") or bloco.get("texto_original") or ""))
    tipo = normalize_tipo(bloco.get("tipo_imovel"))
    valor_total = _to_float(bloco.get("valor_total") or bloco.get("valor_venda") or bloco.get("valor_orcamento_maximo"))
    area_m2 = _to_float(bloco.get("area_m2") or bloco.get("area_privativa_m2") or bloco.get("area_terreno_m2"))
    bairro = bloco.get("bairro") or bloco.get("bairro_normalizado")
    bairro_tier = dictionaries["bairro_tiers"].get(normalize_key(str(bairro or "")), "indefinido")
    attrs = bloco.get("atributos") or {}
    rules = dictionaries["rules"]

    segmento_uso = infer_segmento(tipo)
    mcmv_indicio = "sim" if _contains_any(text, dictionaries["mcmv_keywords"]) else "nao"
    premium_hits = premium_score(text, attrs, dictionaries["premium_keywords"])
    valor_m2 = round(valor_total / area_m2, 2) if valor_total and area_m2 else None
    motivos: list[str] = []

    if tipo == "indefinido" and bairro_tier == "indefinido":
        motivo = "sem_valor_tipo_bairro" if not valor_total else "valor_sem_tipo_bairro"
        return _result(tipo, segmento_uso, "indefinido", mcmv_indicio, "indefinido", faixa_valor(valor_total, rules), valor_m2, confidence(valor_total, tipo, bairro_tier, area_m2), [motivo], "indefinido", bairro_tier)

    if segmento_uso == "comercial":
        return _result(tipo, segmento_uso, "nao_aplicavel", mcmv_indicio, "nao", faixa_valor(valor_total, rules), valor_m2, confidence(valor_total, tipo, bairro_tier, area_m2), ["segmento_comercial"], "classificado", bairro_tier)

    if segmento_uso == "rural":
        return _result(tipo, segmento_uso, "nao_aplicavel", mcmv_indicio, "nao", faixa_valor(valor_total, rules), valor_m2, confidence(valor_total, tipo, bairro_tier, area_m2), ["segmento_rural"], "classificado", bairro_tier)

    if tipo in LOT_TYPES:
        return classify_lot(tipo, segmento_uso, valor_total, area_m2, bairro_tier, premium_hits, mcmv_indicio, valor_m2, rules)

    if tipo in {"flat", "studio", "kitnet", "apartamento", "casa", "indefinido"}:
        return classify_residential(tipo, segmento_uso, valor_total, area_m2, bairro_tier, premium_hits, mcmv_indicio, valor_m2, rules)

    return _result(tipo, segmento_uso, "indefinido", mcmv_indicio, "indefinido", faixa_valor(valor_total, rules), valor_m2, confidence(valor_total, tipo, bairro_tier, area_m2), motivos or ["regra_nao_coberta"], "indefinido", bairro_tier)


def classify_lot(
    tipo: str,
    segmento_uso: str,
    valor_total: float | None,
    area_m2: float | None,
    bairro_tier: str,
    premium_hits: list[str],
    mcmv_indicio: str,
    valor_m2: float | None,
    rules: dict[str, Any],
) -> dict[str, Any]:
    motivos: list[str] = []
    if area_m2 and area_m2 >= rules["area_investimento_min_m2"]:
        motivos.append("area_estrategica_investimento")
        padrao = "alto"
    elif premium_hits or bairro_tier == "alto":
        motivos.extend(premium_hits or ["bairro_tier_alto"])
        padrao = "alto"
    elif valor_total and valor_total <= rules["lote_popular_max"] and (not area_m2 or 100 <= area_m2 <= 300):
        motivos.append("lote_valor_ate_120k")
        padrao = "popular_mcmv"
    elif valor_total and valor_total <= rules["lote_popular_possivel_max"] and bairro_tier == "popular":
        motivos.append("lote_popular_possivel")
        padrao = "popular_mcmv"
    elif valor_total and valor_total <= rules["lote_medio_max"]:
        motivos.append("lote_valor_medio")
        padrao = "medio"
    elif valor_total and valor_total > rules["lote_medio_max"]:
        motivos.append("lote_valor_alto")
        padrao = "alto"
    else:
        motivos.append("lote_sem_valor_suficiente")
        padrao = "indefinido"

    mcmv_possivel = "sim" if padrao == "popular_mcmv" else "nao"
    status = "classificado" if padrao != "indefinido" else "indefinido"
    return _result(tipo, segmento_uso, padrao, mcmv_indicio, mcmv_possivel, faixa_valor(valor_total, rules), valor_m2, confidence(valor_total, tipo, bairro_tier, area_m2), motivos, status, bairro_tier)


def classify_residential(
    tipo: str,
    segmento_uso: str,
    valor_total: float | None,
    area_m2: float | None,
    bairro_tier: str,
    premium_hits: list[str],
    mcmv_indicio: str,
    valor_m2: float | None,
    rules: dict[str, Any],
) -> dict[str, Any]:
    motivos: list[str] = []
    compact = tipo in {"flat", "studio", "kitnet", "apartamento"} and area_m2 and area_m2 <= rules["compacto_area_max_m2"]

    if premium_hits and ("luxo" in premium_hits or "alto luxo" in premium_hits or "porteira fechada" in premium_hits):
        padrao = "luxo"
        motivos.extend(premium_hits)
    elif valor_total and valor_total >= 1000000:
        padrao = "luxo"
        motivos.append("valor_total_1mi_mais")
    elif premium_hits or (bairro_tier == "alto" and valor_total and valor_total > 600000):
        padrao = "alto"
        motivos.extend(premium_hits or ["bairro_alto_valor_acima_600k"])
    elif compact and valor_total and valor_total >= rules["compacto_medio_min_valor"]:
        padrao = "medio"
        motivos.append("compacto_medio")
    elif valor_total and valor_total <= rules["mcmv_valor_max_residencial"] and bairro_tier != "alto" and not premium_hits:
        padrao = "popular_mcmv"
        motivos.append("valor_total_ate_275k")
    elif mcmv_indicio == "sim" and not premium_hits:
        padrao = "popular_mcmv"
        motivos.append("mcmv_indicio_textual")
    elif valor_total and valor_total <= 600000:
        padrao = "medio"
        motivos.append("valor_total_275k_600k")
    elif valor_total and valor_total > 600000:
        padrao = "alto"
        motivos.append("valor_total_acima_600k")
    else:
        padrao = "indefinido"
        motivos.append("residencial_sem_valor_suficiente")

    mcmv_possivel = "sim" if segmento_uso == "residencial" and valor_total and valor_total <= rules["mcmv_valor_max_residencial"] and bairro_tier != "alto" else "nao"
    if mcmv_indicio == "sim":
        mcmv_possivel = "sim"
    status = "classificado" if padrao != "indefinido" else "indefinido"
    return _result(tipo, segmento_uso, padrao, mcmv_indicio, mcmv_possivel, faixa_valor(valor_total, rules), valor_m2, confidence(valor_total, tipo, bairro_tier, area_m2), motivos, status, bairro_tier)


def normalize_tipo(tipo: Any) -> str:
    value = str(tipo) if tipo is not None else "INDEFINIDO"
    if value.lower() in {"casa", "apartamento", "lote", "terreno", "flat", "studio", "kitnet", "galpao", "sala_comercial", "ponto_comercial", "chacara", "sitio", "indefinido"}:
        return value.lower()
    return TYPE_MAP.get(value.upper(), "indefinido")


def infer_segmento(tipo: str) -> str:
    if tipo in COMMERCIAL_TYPES:
        return "comercial"
    if tipo in RURAL_TYPES:
        return "rural"
    if tipo in RESIDENTIAL_TYPES or tipo == "indefinido":
        return "residencial" if tipo != "indefinido" else "indefinido"
    return "indefinido"


def faixa_valor(valor_total: float | None, rules: dict[str, Any]) -> str | None:
    if not valor_total:
        return None
    for item in rules["faixas_valor"]:
        min_value = item["min"]
        max_value = item["max"]
        if valor_total >= min_value and (max_value is None or valor_total <= max_value):
            return item["id"]
    return None


def premium_score(text: str, attrs: dict[str, Any], keywords: list[str]) -> list[str]:
    hits = [normalize_key(term) for term in keywords if normalize_key(term) in text]
    attr_map = {
        "piscina": attrs.get("piscina") or attrs.get("piscina_flag"),
        "mobiliado": attrs.get("mobiliado") or attrs.get("mobiliado_flag"),
        "2_vagas": (attrs.get("vagas") or attrs.get("vagas_garagem") or 0) >= 2,
        "suite": (attrs.get("suites") or 0) >= 1,
    }
    hits.extend(key for key, active in attr_map.items() if active)
    return sorted(set(hits))


def confidence(valor_total: float | None, tipo: str, bairro_tier: str, area_m2: float | None) -> float:
    score = 0.18
    if valor_total:
        score += 0.32
    if tipo != "indefinido":
        score += 0.22
    if bairro_tier != "indefinido":
        score += 0.18
    if area_m2:
        score += 0.1
    return round(min(score, 0.95), 2)


def _result(
    tipo: str,
    segmento_uso: str,
    padrao: str,
    mcmv_indicio: str,
    mcmv_possivel: str,
    faixa: str | None,
    valor_m2: float | None,
    conf: float,
    motivos: list[str],
    status: str,
    bairro_tier: str,
) -> dict[str, Any]:
    return {
        "tipo_imovel_fisico": tipo,
        "segmento_uso": segmento_uso,
        "padrao_economico": padrao,
        "mcmv_indicio": mcmv_indicio,
        "mcmv_possivel": mcmv_possivel,
        "faixa_valor": faixa,
        "valor_m2_estimado": valor_m2,
        "confidence_padrao": conf,
        "motivos_classificacao": motivos,
        "status_padrao": status,
        "tier_mercado": bairro_tier,
    }


def _contains_any(text: str, terms: list[str]) -> bool:
    return any(normalize_key(term) in text for term in terms)


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_jsonish(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _invert_tiers(tiers: dict[str, list[str]]) -> dict[str, str]:
    return {normalize_key(bairro): tier for tier, bairros in tiers.items() for bairro in bairros}
