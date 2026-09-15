from __future__ import annotations

import re
from dataclasses import dataclass

from scripts.normalize_text import normalize_key


MONEY_RE = re.compile(
    r"(?P<prefix>r\$\s*|\$\s*)?"
    r"(?P<number>\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)"
    r"\s*(?P<suffix>mil|k|mi|milhao|milhoes|milhão|milhões)?",
    re.IGNORECASE,
)


CONTEXT_TERMS = {
    "valor_condominio": ["condominio", "cond"],
    "valor_iptu": ["iptu"],
    "valor_entrada": ["entrada", "sinal"],
    "valor_saldo": ["saldo", "saldo devedor"],
    "valor_parcela": ["parcela", "prestacao"],
    "valor_repasse_agio": ["repasse", "agio"],
    "valor_orcamento_maximo": ["ate", "maximo", "orcamento"],
    "valor_locacao": ["aluguel", "locacao", "alugo", "mensal"],
    "valor_venda": ["venda", "vendo", "valor de venda"],
}
NORMALIZED_CONTEXT_TERMS = {
    field: tuple(normalize_key(term) for term in terms)
    for field, terms in CONTEXT_TERMS.items()
}


@dataclass
class MoneyMention:
    value: float
    field: str | None
    raw: str
    has_context: bool


def parse_number(number_text: str, suffix: str | None) -> float:
    cleaned = (number_text or "").strip().replace(" ", "")
    suffix_key = normalize_key(suffix or "")
    if suffix_key in {"mi", "milhao", "milhoes"} and "," not in cleaned and cleaned.count(".") == 1:
        value = float(cleaned)
    elif "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
        value = float(cleaned)
    elif "." in cleaned:
        parts = cleaned.split(".")
        cleaned = "".join(parts) if all(len(part) == 3 for part in parts[1:]) else cleaned
        value = float(cleaned)
    else:
        value = float(cleaned)

    if suffix_key in {"k", "mil"} and value < 10000:
        value *= 1000
    elif suffix_key in {"mi", "milhao", "milhoes"}:
        value *= 1000 if value >= 50 else 1000000
    return value


def extract_values(text: str, intent: str) -> dict[str, object]:
    result: dict[str, object] = {
        "valor_venda": None,
        "valor_locacao": None,
        "valor_condominio": None,
        "valor_iptu": None,
        "valor_entrada": None,
        "valor_saldo": None,
        "valor_parcela": None,
        "valor_repasse_agio": None,
        "valor_orcamento_maximo": None,
        "valor_orcamento_minimo": None,
        "valor_original_texto": None,
        "valor_confianca": 0.0,
        "valor_ambiguidade_flag": False,
    }

    mentions = list(_find_mentions(text, intent))
    if not mentions:
        return result

    raw_values: list[str] = []
    unassigned = 0
    for mention in mentions:
        raw_values.append(mention.raw)
        field = mention.field or _field_from_intent(mention.value, intent)
        if field is None:
            unassigned += 1
            continue
        if field == "valor_orcamento_maximo" and intent == "DEMANDA_LOCACAO" and mention.value > 20000:
            unassigned += 1
            continue
        if field == "valor_orcamento_maximo" and intent == "DEMANDA_COMPRA" and mention.value < 50000:
            unassigned += 1
            continue
        if not _is_plausible_value(field, mention.value):
            unassigned += 1
            continue
        _set_value(result, field, mention.value)

    result["valor_original_texto"] = " | ".join(raw_values[:8])
    result["valor_confianca"] = 0.86 if any(mention.has_context for mention in mentions) else 0.62
    result["valor_ambiguidade_flag"] = unassigned > 1
    return result


def _find_mentions(text: str, intent: str) -> list[MoneyMention]:
    mentions: list[MoneyMention] = []
    previous_line_norm = ""
    for line in (text or "").splitlines():
        line_norm = normalize_key(line)
        for match in MONEY_RE.finditer(line):
            prefix = match.group("prefix")
            suffix = match.group("suffix")
            number_text = match.group("number")
            raw = match.group(0).strip()
            if not raw:
                continue

            try:
                value = parse_number(number_text, suffix)
            except ValueError:
                continue

            field = _context_field(line, match.start(), match.end())
            has_context = field is not None
            has_currency = bool(prefix)
            has_suffix = bool(suffix)
            has_large_format = "." in number_text and value >= 10000

            if (
                field is None
                and not has_currency
                and not has_suffix
                and any(term in f"{previous_line_norm} {line_norm}" for term in ("cep", "creci"))
            ):
                continue
            if not (has_currency or has_suffix or has_context or has_large_format):
                continue
            if not has_context and value < 500 and intent not in {"OFERTA_REPASSE"}:
                continue

            if field == "valor_saldo" and not has_suffix and 20 <= value <= 999 and intent in {"OFERTA_REPASSE", "OFERTA_VENDA"}:
                value *= 1000

            mentions.append(MoneyMention(value=round(value, 2), field=field, raw=raw, has_context=has_context))
        previous_line_norm = line_norm
    return mentions


def _context_field(line: str, start: int, end: int) -> str | None:
    before = normalize_key(line[max(0, start - 45) : start])
    after = normalize_key(line[end : end + 35])
    best_field = None
    best_pos = -1
    for field, terms in NORMALIZED_CONTEXT_TERMS.items():
        for term in terms:
            pos = before.rfind(term)
            if pos > best_pos:
                best_pos = pos
                best_field = field
    if best_field:
        return best_field
    for field, terms in NORMALIZED_CONTEXT_TERMS.items():
        if any(term in after for term in terms):
            return field
    return None


def _field_from_intent(value: float, intent: str) -> str | None:
    if intent == "DEMANDA_COMPRA":
        return "valor_orcamento_maximo" if value >= 50000 else None
    if intent == "DEMANDA_LOCACAO":
        return "valor_orcamento_maximo" if 200 <= value <= 20000 else None
    if intent == "OFERTA_LOCACAO":
        return "valor_locacao" if value < 20000 else None
    if intent == "OFERTA_REPASSE":
        return "valor_repasse_agio" if value < 100000 else "valor_saldo"
    if intent == "OFERTA_VENDA":
        return "valor_venda" if value >= 10000 else None
    return "valor_locacao" if value < 10000 else "valor_venda"


def _is_plausible_value(field: str, value: float) -> bool:
    if field in {"valor_venda", "valor_saldo"}:
        return 50000 <= value <= 10000000
    if field == "valor_repasse_agio":
        return 1000 <= value <= 500000
    if field in {"valor_locacao", "valor_parcela"}:
        return 100 <= value <= 30000
    if field == "valor_orcamento_maximo":
        return value >= 200
    if field in {"valor_condominio", "valor_iptu"}:
        return 1 <= value <= 10000
    if field in {"valor_entrada", "valor_orcamento_minimo"}:
        return value >= 1
    return True


def _set_value(result: dict[str, object], field: str, value: float) -> None:
    current = result.get(field)
    if current is None:
        result[field] = int(value) if float(value).is_integer() else value
    elif field in {"valor_venda", "valor_saldo", "valor_orcamento_maximo"}:
        result[field] = max(float(current), value)
    elif field in {"valor_locacao", "valor_condominio", "valor_iptu", "valor_parcela"}:
        result[field] = min(float(current), value)
