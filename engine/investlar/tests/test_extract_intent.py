from scripts.extract_intent import classify_intent


def test_classifies_main_market_intents():
    cases = {
        "vendo casa no catole": "OFERTA_VENDA",
        "alugo apartamento mobiliado": "OFERTA_LOCACAO",
        "repasse com saldo e parcela": "OFERTA_REPASSE",
        "tenho cliente para comprar casa": "DEMANDA_COMPRA",
        "alguem tem apartamento para locacao": "DEMANDA_LOCACAO",
        "proprietario quer vender casa": "CAPTACAO_VENDA",
        "dono quer colocar para alugar": "CAPTACAO_LOCACAO",
        "aceita permuta por terreno": "PERMUTA",
        "bom dia": "RUIDO",
        "informacao incompleta sobre imovel": "INDEFINIDA",
    }

    for text, expected in cases.items():
        assert classify_intent(text).intencao_mercado == expected
