import json
import re
from pathlib import Path


PHONE_PATTERN = re.compile(r"(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b")


def test_public_json_contract_does_not_include_raw_private_fields():
    public_dir = Path("public/data")
    if not public_dir.exists():
        return

    for path in public_dir.glob("*.json"):
        if path.name in {"sender_directory.json", "broker_messages.json"}:
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        text = json.dumps(payload, ensure_ascii=False).lower()
        assert "raw_sender" not in text
        assert ".vcf" not in text
        assert "telefone" not in text or path.name == "samples_review.json"
        for value in iter_public_strings(payload):
            assert not PHONE_PATTERN.search(value)


def iter_public_strings(payload, key=None):
    if key == "source_hash":
        return
    if isinstance(payload, dict):
        for child_key, value in payload.items():
            yield from iter_public_strings(value, child_key)
    elif isinstance(payload, list):
        for value in payload:
            yield from iter_public_strings(value, key)
    elif isinstance(payload, str):
        yield payload
