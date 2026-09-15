from scripts.classify_market_operation import classify_market_operation
from scripts.normalize_text import mask_private_text


def test_market_operation_normalized_keys():
    cases = {
        "OFERTA_VENDA": "venda_ofertada",
        "DEMANDA_COMPRA": "compra_procurada",
        "OFERTA_LOCACAO": "locacao_ofertada",
        "DEMANDA_LOCACAO": "locacao_procurada",
        "OFERTA_REPASSE": "repasse",
        "PERMUTA": "permuta",
        "INDEFINIDA": "indefinida",
    }
    for intent, expected in cases.items():
        assert classify_market_operation(intent)["operacao_mercado"] == expected


def test_mask_private_text_removes_hidden_media_token():
    text = "Casa no Catolé\n<Mídia oculta>\n<Midia oculta>\nR$ 250 mil"
    masked = mask_private_text(text)
    assert "<Mídia oculta>" not in masked
    assert "<Midia oculta>" not in masked
    assert "Casa no Catolé" in masked
