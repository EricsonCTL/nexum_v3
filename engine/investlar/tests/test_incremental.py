import json
from pathlib import Path

import pytest

from incremental import (
    SOURCE_ID,
    analyze_file,
    candidate_neighborhood,
    iter_whatsapp_messages,
    message_identity,
    process_file,
)


def write_export(tmp_path: Path, lines: list[str]) -> Path:
    path = tmp_path / "conversa.txt"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def test_checkpoint_name_phone_multiline_and_same_minute(tmp_path):
    path = write_export(tmp_path, [
        "03/05/2026 12:26 - +55 83 8862-5551: Casa no Catolé",
        "com 3 quartos",
        "03/05/2026 12:27 - Maria Corretora: Procuro apartamento no Centro",
        "03/05/2026 12:27 - Maria Corretora: Procuro apartamento no Centro",
    ])
    messages = list(iter_whatsapp_messages(path))
    first = message_identity(messages[0], SOURCE_ID, 1)
    preview = analyze_file(path, SOURCE_ID, first)
    assert preview["newMessageCount"] == 2
    assert preview["checkpointFinal"]["senderKind"] == "nome"
    assert preview["checkpointFinal"]["occurrence"] == 2
    assert messages[0]["message"].endswith("com 3 quartos")


def test_missing_checkpoint_is_safe(tmp_path):
    path = write_export(tmp_path, ["03/05/2026 12:27 - Maria: Procuro apartamento"])
    with pytest.raises(ValueError, match="checkpoint"):
        analyze_file(path, SOURCE_ID, {"fingerprint": "inexistente"})


def test_invalid_encoding_is_rejected(tmp_path):
    path = tmp_path / "latin1.txt"
    path.write_bytes("03/05/2026 12:26 - João: imóvel".encode("latin-1"))
    with pytest.raises(UnicodeDecodeError):
        analyze_file(path, SOURCE_ID, None)


def test_process_known_and_unknown_neighborhood(tmp_path):
    path = write_export(tmp_path, [
        "04/05/2026 09:00 - João: Vendo apartamento no Catolé por 380 mil",
        "04/05/2026 10:00 - +55 83 99999-0000: Vendo casa no bairro Jardim Aurora por 250 mil",
    ])
    neighborhoods = tmp_path / "neighborhoods.json"
    neighborhoods.write_text(json.dumps([{"id":"BAI-catole","nome":"Catolé","cidade":"Campina Grande","uf":"PB","latitude":-7.24,"longitude":-35.88}]), encoding="utf-8")
    directory = tmp_path / "senders.json"
    directory.write_text("[]", encoding="utf-8")
    result = process_file(path, SOURCE_ID, None, "imp_test", neighborhoods, directory)
    assert result["newMessageCount"] == 2
    assert len(result["opportunities"]) == 2
    assert any(item["type"] == "bairro_novo" and item["candidateName"] == "Jardim Aurora" for item in result["reviews"])
    assert len(result["directoryUpdates"]) == 2


def test_candidate_requires_explicit_bairro():
    assert candidate_neighborhood("casa no Jardim Aurora", set()) is None
    assert candidate_neighborhood("casa no bairro Jardim Aurora com piscina", set()) == "Jardim Aurora"
    assert candidate_neighborhood("casa no bairro Catolé", {"catole"}) is None


def test_large_export_only_returns_suffix(tmp_path):
    path = tmp_path / "grande.txt"
    with path.open("w", encoding="utf-8") as handle:
        for index in range(100_000):
            day = 1 + (index // 1440) % 28
            hour = (index // 60) % 24
            minute = index % 60
            handle.write(f"{day:02d}/01/2026 {hour:02d}:{minute:02d} - Corretor {index % 20}: Mensagem imobiliária {index}\n")
    messages = iter_whatsapp_messages(path)
    checkpoint = None
    for index, message in enumerate(messages):
        if index == 96_999:
            checkpoint = message_identity(message, SOURCE_ID, 1)
            break
    preview = analyze_file(path, SOURCE_ID, checkpoint)
    assert preview["newMessageCount"] == 3_000
