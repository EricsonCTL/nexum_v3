from __future__ import annotations

from dataclasses import dataclass

from scripts.normalize_text import normalize_key


@dataclass(frozen=True)
class IntentResult:
    intencao_mercado: str
    lado_negociacao: str
    confianca_intencao: float
    ambiguous: bool = False


NOISE_EXACT = {
    "aguardando mensagem",
    "pv",
    "pvd",
    "privado",
    "ok",
    "up",
    "bom dia",
    "boa tarde",
    "boa noite",
    "obrigado",
    "obrigada",
    "valor",
    "valor ?",
    "qual valor",
    "midia oculta",
}


def _has(text: str, *terms: str) -> bool:
    haystack = f" {text} "
    return any(f" {term} " in haystack for term in terms)


TERMS = {
    name: tuple(normalize_key(term) for term in values)
    for name, values in {
        "demand": ["tenho cliente", "cliente para", "procuro", "busco", "alguem tem", "algum com", "preciso", "opcoes no privado"],
        "rent": ["locacao", "aluguel", "alugar", "alugo", "aluga"],
        "sale": ["venda", "vendo", "vende", "vender", "comprar", "compra", "financiavel"],
        "listing": ["disponivel", "vendo", "vende", "vender", "alugo", "aluga", "aluguel"],
        "capture": ["captacao", "captar", "proprietario quer", "dono quer", "colocar para"],
        "repasse": ["repasse", "agio", "saldo", "parcela"],
        "permuta": ["permuta", "troca", "aceita troca"],
        "financing": ["comprar", "financiamento"],
    }.items()
}


def classify_intent(text: str) -> IntentResult:
    normalized = normalize_key(text)
    compact = normalized.strip()

    if not compact or compact in NOISE_EXACT:
        return IntentResult("RUIDO", "INDEFINIDO", 0.96)
    if compact.replace("midia oculta", "").strip() == "":
        return IntentResult("RUIDO", "INDEFINIDO", 0.98)

    has_demand = _has(normalized, *TERMS["demand"])
    has_rent = _has(normalized, *TERMS["rent"])
    has_sale = _has(normalized, *TERMS["sale"])
    has_listing = _has(normalized, *TERMS["listing"])
    has_capture = _has(normalized, *TERMS["capture"])
    has_repasse = _has(normalized, *TERMS["repasse"])
    has_permuta = _has(normalized, *TERMS["permuta"])

    if has_permuta and not has_repasse:
        return IntentResult("PERMUTA", "INDEFINIDO", 0.82)

    if has_capture and has_rent:
        return IntentResult("CAPTACAO_LOCACAO", "CAPTACAO", 0.82)
    if has_capture and has_sale:
        return IntentResult("CAPTACAO_VENDA", "CAPTACAO", 0.82)

    if has_demand and has_rent and (has_sale or _has(normalized, *TERMS["financing"])):
        return IntentResult("DEMANDA_LOCACAO", "DEMANDA", 0.68, ambiguous=True)
    if has_demand and has_rent:
        return IntentResult("DEMANDA_LOCACAO", "DEMANDA", 0.9)
    if has_demand and (has_sale or _has(normalized, *TERMS["financing"])):
        return IntentResult("DEMANDA_COMPRA", "DEMANDA", 0.88)

    if has_repasse:
        return IntentResult("OFERTA_REPASSE", "OFERTA", 0.82)

    if has_listing and has_rent and has_sale:
        return IntentResult("OFERTA_LOCACAO", "OFERTA", 0.68, ambiguous=True)
    if has_listing and has_rent:
        return IntentResult("OFERTA_LOCACAO", "OFERTA", 0.86)
    if has_listing and has_sale:
        return IntentResult("OFERTA_VENDA", "OFERTA", 0.86)

    if has_rent and not has_demand:
        return IntentResult("OFERTA_LOCACAO", "OFERTA", 0.68)
    if has_sale and not has_demand:
        return IntentResult("OFERTA_VENDA", "OFERTA", 0.66)

    return IntentResult("INDEFINIDA", "INDEFINIDO", 0.35)
