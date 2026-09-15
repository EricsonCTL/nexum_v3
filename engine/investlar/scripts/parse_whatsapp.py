from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

MESSAGE_RE = re.compile(
    r"^(?P<date>\d{2}/\d{2}/\d{4}) (?P<time>\d{2}:\d{2}) - (?P<body>.*)$"
)

SYSTEM_HINTS = (
    "mensagens e ligações são protegidas",
    "mensagens e ligacoes sao protegidas",
    "criou o grupo",
    "você foi adicionado",
    "voce foi adicionado",
    "adicionou",
    "removeu",
    "saiu",
    "entrou usando o link",
)


def parse_datetime(date_text: str, time_text: str) -> datetime:
    return datetime.strptime(f"{date_text} {time_text}", "%d/%m/%Y %H:%M")


def is_system_body(body: str) -> bool:
    lower = (body or "").lower()
    return any(hint in lower for hint in SYSTEM_HINTS)


def _finish_message(current: dict[str, Any] | None, messages: list[dict[str, Any]]) -> None:
    if current is None:
        return
    text = current.get("message") or ""
    current["message"] = text.strip()
    current["has_media"] = "<Mídia oculta>" in text or "<Midia oculta>" in text
    current["media_count"] = text.count("<Mídia oculta>") + text.count("<Midia oculta>")
    messages.append(current)


def parse_whatsapp_txt(path: str | Path) -> list[dict[str, Any]]:
    txt_path = Path(path)
    messages: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    with txt_path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\r\n")
            match = MESSAGE_RE.match(line)
            if match:
                _finish_message(current, messages)
                body = match.group("body")
                sender = None
                message = body
                is_system = True
                if ": " in body and not is_system_body(body):
                    sender, message = body.split(": ", 1)
                    is_system = False

                dt = parse_datetime(match.group("date"), match.group("time"))
                current = {
                    "message_id": f"msg_{len(messages) + 1:06d}",
                    "line_start": line_number,
                    "datetime": dt,
                    "date": dt.date().isoformat(),
                    "time": dt.strftime("%H:%M"),
                    "raw_sender": sender,
                    "message": message,
                    "is_system": is_system,
                    "has_media": False,
                    "media_count": 0,
                }
            elif current is not None:
                current["message"] = f"{current['message']}\n{line}"

    _finish_message(current, messages)
    return messages


def locate_conversation_txt(input_dir: str | Path) -> Path:
    candidates = sorted(Path(input_dir).glob("*.txt"), key=lambda item: item.stat().st_size, reverse=True)
    if not candidates:
        raise FileNotFoundError(f"Nenhum arquivo .txt encontrado em {input_dir}")
    return candidates[0]
