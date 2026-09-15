from __future__ import annotations

from datetime import timedelta
from typing import Any


def group_messages(
    messages: list[dict[str, Any]],
    window_minutes: int = 12,
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    max_gap = timedelta(minutes=window_minutes)

    for message in messages:
        if message.get("is_system") or not message.get("raw_sender"):
            if current is not None:
                blocks.append(current)
                current = None
            continue

        if current is None:
            current = _new_block(message)
            continue

        same_sender = message["raw_sender"] == current["raw_sender"]
        close_enough = message["datetime"] - current["data_fim_dt"] <= max_gap
        if same_sender and close_enough:
            current["messages"].append(message)
            current["data_fim_dt"] = message["datetime"]
            current["media_count"] += message.get("media_count", 0)
            current["tem_midia"] = current["tem_midia"] or message.get("has_media", False)
        else:
            blocks.append(current)
            current = _new_block(message)

    if current is not None:
        blocks.append(current)

    for index, block in enumerate(blocks, start=1):
        block["block_id"] = f"blk_{index:06d}"
        block["texto_original"] = "\n".join(item["message"] for item in block["messages"]).strip()
        block["message_count"] = len(block["messages"])
        block["data_inicio"] = block["data_inicio_dt"].isoformat(timespec="minutes") + "-03:00"
        block["data_fim"] = block["data_fim_dt"].isoformat(timespec="minutes") + "-03:00"
        block["date"] = block["data_inicio_dt"].date().isoformat()

    return blocks


def _new_block(message: dict[str, Any]) -> dict[str, Any]:
    return {
        "raw_sender": message["raw_sender"],
        "sender_id": message.get("sender_id"),
        "messages": [message],
        "data_inicio_dt": message["datetime"],
        "data_fim_dt": message["datetime"],
        "media_count": message.get("media_count", 0),
        "tem_midia": message.get("has_media", False),
    }
