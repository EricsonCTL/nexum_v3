from pathlib import Path

from scripts.group_blocks import group_messages
from scripts.parse_whatsapp import parse_whatsapp_txt


def test_parse_whatsapp_multiline_system_and_media(tmp_path: Path):
    sample = tmp_path / "chat.txt"
    sample.write_text(
        "08/01/2025 10:00 - Você foi adicionado(a)\n"
        "08/01/2025 10:01 - Maria Silva: Casa no Catolé\n"
        "3 quartos\n"
        "250 mil\n"
        "08/01/2025 10:02 - Maria Silva: <Mídia oculta>\n",
        encoding="utf-8",
    )

    messages = parse_whatsapp_txt(sample)

    assert len(messages) == 3
    assert messages[0]["is_system"] is True
    assert messages[1]["raw_sender"] == "Maria Silva"
    assert "3 quartos" in messages[1]["message"]
    assert messages[2]["has_media"] is True


def test_group_blocks_joins_fragmented_listing(tmp_path: Path):
    sample = tmp_path / "chat.txt"
    sample.write_text(
        "08/01/2025 10:01 - Maria Silva: Casa no Catolé\n"
        "08/01/2025 10:03 - Maria Silva: 3 quartos\n"
        "08/01/2025 10:04 - Maria Silva: 250 mil\n"
        "08/01/2025 10:05 - João Lima: Tenho cliente para locação\n",
        encoding="utf-8",
    )
    messages = parse_whatsapp_txt(sample)
    for message in messages:
        message["sender_id"] = "snd_0001" if message["raw_sender"] == "Maria Silva" else "snd_0002"

    blocks = group_messages(messages)

    assert len(blocks) == 2
    assert blocks[0]["message_count"] == 3
    assert "250 mil" in blocks[0]["texto_original"]
