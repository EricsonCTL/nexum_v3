"""Gera a camada de revisão mascarada sem alterar o snapshot analítico."""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from incremental import iter_whatsapp_messages
from scripts.group_blocks import group_messages
from scripts.normalize_text import mask_private_text


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed de conversas mascaradas para a Revisão NEXUM")
    parser.add_argument("--input", required=True)
    parser.add_argument("--opportunities", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    opportunities = json.loads(Path(args.opportunities).read_text(encoding="utf-8"))
    directory = json.loads(Path(args.directory).read_text(encoding="utf-8"))
    sender_ids = {str(row.get("raw_sender") or ""): str(row.get("sender_id") or "") for row in directory}
    opportunities_by_key: dict[tuple[str, str], deque[dict]] = defaultdict(deque)
    for row in opportunities:
        key = (str(row.get("data_inicio") or ""), str(row.get("sender_id") or ""))
        opportunities_by_key[key].append(row)

    messages = list(iter_whatsapp_messages(Path(args.input)))
    for message in messages:
        message["sender_id"] = sender_ids.get(str(message.get("raw_sender") or ""), "")
    blocks = group_messages(messages)
    transcripts = []
    for block in blocks:
        key = (str(block.get("data_inicio") or ""), str(block.get("sender_id") or ""))
        if not opportunities_by_key[key]:
            continue
        opportunity = opportunities_by_key[key].popleft()
        transcripts.append(
            {
                "opportunityId": opportunity.get("id"),
                "occurredAt": opportunity.get("data_inicio"),
                "senderId": opportunity.get("sender_id"),
                "sourceMessageMasked": mask_private_text(str(block.get("texto_original") or "")),
            }
        )

    transcripts.sort(key=lambda row: str(row.get("occurredAt") or ""), reverse=True)
    payload = {"version": 1, "masked": True, "records": transcripts}
    output = Path(args.output)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"messages": len(messages), "blocks": len(blocks), "matched": len(transcripts), "opportunities": len(opportunities)}))


if __name__ == "__main__":
    main()
