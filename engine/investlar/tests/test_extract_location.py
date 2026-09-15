from scripts.extract_location import extract_location, load_location_dictionaries


def test_location_aliases_and_outside_city():
    dictionaries = load_location_dictionaries("dictionaries")

    assert extract_location("Casa no catole", dictionaries)["bairro_normalizado"] == "Catolé"
    assert extract_location("Apartamento em bodocongo", dictionaries)["bairro_normalizado"] == "Bodocongó"
    assert extract_location("Casa no pres medici", dictionaries)["bairro_normalizado"] == "Presidente Médici"
    assert extract_location("Apartamento em Joao Pessoa", dictionaries)["fora_campina_grande_flag"] is True
    assert extract_location("Área em Caruaru na BR-104", dictionaries)["fora_campina_grande_flag"] is True
