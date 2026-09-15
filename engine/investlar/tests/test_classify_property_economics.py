from scripts.classify_property_economics import classificar_padrao_imovel, load_economic_dictionaries


DICTS = load_economic_dictionaries("dictionaries")


def classify(**kwargs):
    return classificar_padrao_imovel(kwargs, DICTS)


def test_lote_100k_200m_popular():
    result = classify(tipo_imovel="lote", valor_total=100000, area_m2=200, bairro="Malvinas")
    assert result["padrao_economico"] == "popular_mcmv"


def test_lote_264k_itarare_medio():
    result = classify(tipo_imovel="lote", valor_total=264000, area_m2=200, bairro="Itararé")
    assert result["padrao_economico"] in {"medio", "alto"}
    assert result["tier_mercado"] == "medio_alto"


def test_terreno_grande_alto_branco_investimento_not_popular():
    result = classify(tipo_imovel="terreno", valor_total=100000, area_m2=1300, bairro="Alto Branco")
    assert result["padrao_economico"] == "alto"
    assert "area_estrategica_investimento" in result["motivos_classificacao"]


def test_casa_170k_mcmv_possivel():
    result = classify(tipo_imovel="casa", valor_total=170000, bairro="Dinamérica")
    assert result["padrao_economico"] == "popular_mcmv"
    assert result["mcmv_possivel"] == "sim"


def test_casa_420k_medio():
    result = classify(tipo_imovel="casa", valor_total=420000, bairro="Dinamérica")
    assert result["padrao_economico"] == "medio"


def test_apartamento_compacto_200k_nao_popular_automatico():
    result = classify(tipo_imovel="apartamento", valor_total=200000, area_m2=30, bairro="Centro")
    assert result["padrao_economico"] == "medio"
    assert "compacto_medio" in result["motivos_classificacao"]


def test_casa_1mi_premium_luxo():
    result = classify(tipo_imovel="casa", valor_total=1000000, bairro="Catolé", texto_normalizado="casa luxo premium")
    assert result["padrao_economico"] == "luxo"


def test_comercial_nao_aplicavel():
    result = classify(tipo_imovel="galpao", valor_total=900000, bairro="Centro")
    assert result["segmento_uso"] == "comercial"
    assert result["padrao_economico"] == "nao_aplicavel"


def test_mcmv_indicio_textual():
    result = classify(tipo_imovel="casa", valor_total=260000, bairro="Malvinas", texto_normalizado="minha casa minha vida entrada facilitada")
    assert result["mcmv_indicio"] == "sim"


def test_sem_valor_sem_bairro_indefinido():
    result = classify(tipo_imovel="indefinido")
    assert result["padrao_economico"] == "indefinido"


def test_so_valor_sem_tipo_sem_bairro_nao_classifica_padrao():
    result = classify(tipo_imovel="indefinido", valor_total=180000)
    assert result["padrao_economico"] == "indefinido"
