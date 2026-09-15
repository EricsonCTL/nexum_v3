from __future__ import annotations


def classify_market_operation(intent: str | None) -> dict[str, str]:
    intent = (intent or "INDEFINIDA").upper()
    if intent in {"OFERTA_VENDA", "VENDA", "CAPTACAO_VENDA"}:
        return {"operacao_mercado": "venda_ofertada", "operacao_label": "Venda ofertada"}
    if intent in {"DEMANDA_COMPRA", "COMPRA"}:
        return {"operacao_mercado": "compra_procurada", "operacao_label": "Compra procurada"}
    if intent in {"OFERTA_LOCACAO", "CAPTACAO_LOCACAO"}:
        return {"operacao_mercado": "locacao_ofertada", "operacao_label": "Locação ofertada"}
    if intent in {"LOCADOR"}:
        return {"operacao_mercado": "locacao_ofertada", "operacao_label": "Locação ofertada"}
    if intent in {"DEMANDA_LOCACAO", "LOCATARIO"}:
        return {"operacao_mercado": "locacao_procurada", "operacao_label": "Locação procurada"}
    if intent in {"OFERTA_REPASSE", "REPASSE"}:
        return {"operacao_mercado": "repasse", "operacao_label": "Repasse"}
    if intent == "PERMUTA":
        return {"operacao_mercado": "permuta", "operacao_label": "Permuta"}
    return {"operacao_mercado": "indefinida", "operacao_label": "Indefinida"}
