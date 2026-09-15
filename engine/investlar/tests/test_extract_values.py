from scripts.extract_values import extract_values


def test_extract_sale_value_variants():
    assert extract_values("Vendo casa por 200 mil", "OFERTA_VENDA")["valor_venda"] == 200000
    assert extract_values("Casa R$ 200.000", "OFERTA_VENDA")["valor_venda"] == 200000
    assert extract_values("Repasse R$25 k", "OFERTA_REPASSE")["valor_repasse_agio"] == 25000
    assert extract_values("Venda R$ 950.000 mil", "OFERTA_VENDA")["valor_venda"] == 950000
    assert extract_values("Valor 1.449 mi", "OFERTA_VENDA")["valor_venda"] == 1449000
    assert extract_values("Venda R$ 430 mi", "OFERTA_VENDA")["valor_venda"] == 430000


def test_extract_context_values():
    text = "Condomínio 130\nParcela 580\nSaldo 122\nR$25 k repasse"
    values = extract_values(text, "OFERTA_REPASSE")

    assert values["valor_condominio"] == 130
    assert values["valor_parcela"] == 580
    assert values["valor_saldo"] == 122000
    assert values["valor_repasse_agio"] == 25000


def test_extract_budget_for_demand():
    values = extract_values("Procuro apartamento para locação até 800", "DEMANDA_LOCACAO")

    assert values["valor_orcamento_maximo"] == 800


def test_does_not_extract_cep_as_sale_value():
    values = extract_values("CEP\n58.414.200\nAluguel R$1.300", "OFERTA_LOCACAO")

    assert values["valor_venda"] is None
    assert values["valor_locacao"] == 1300


def test_rent_offer_does_not_promote_large_uncontexted_number_to_sale():
    values = extract_values("Aluguel R$ 1.500\nCodigo 10.000.000", "OFERTA_LOCACAO")

    assert values["valor_venda"] is None
    assert values["valor_locacao"] == 1500
