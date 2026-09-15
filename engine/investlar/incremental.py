from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.build_public_json import _public_opportunity
from scripts.dedupe_records import dedupe_records
from scripts.extract_location import load_location_dictionaries
from scripts.extract_property_type import load_property_terms
from scripts.group_blocks import group_messages
from scripts.normalize_text import mask_private_text, normalize_key
from scripts.parse_whatsapp import MESSAGE_RE, is_system_body, parse_datetime
from scripts.run_pipeline import build_record, normalize_sender_phone
from scripts.classify_property_economics import load_economic_dictionaries


SOURCE_ID = "construindo-parceria-cg"
PHONE_RE = re.compile(r"^[+\d\s().\-\u200e\u202a\u202c]+$")
EXPLICIT_NEIGHBORHOOD_RE = re.compile(
    r"\b(?:no\s+|na\s+)?bairro\s+(?:do\s+|da\s+|de\s+)?(?P<name>[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{2,50})",
    re.IGNORECASE,
)
NEIGHBORHOOD_STOP_WORDS = {
    "com", "para", "por", "e", "ou", "perto", "proximo", "próximo", "nas", "nos",
    "ate", "até", "valor", "casa", "apartamento", "apto", "terreno", "lote",
}


def canonical_sender(value: str | None) -> str:
    text = re.sub(r"[\u200e\u202a\u202c]", "", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    digits = re.sub(r"\D", "", text)
    if PHONE_RE.fullmatch(text) and len(digits) >= 10:
        return digits if len(digits) >= 12 else f"55{digits}"
    return normalize_key(text)


def sender_kind(value: str | None) -> str:
    return "telefone" if canonical_sender(value).isdigit() else "nome"


def normalized_message(value: str | None) -> str:
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def message_identity(message: dict[str, Any], source_id: str, occurrence: int) -> dict[str, Any]:
    content = normalized_message(message.get("message"))
    content_hash = hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()
    occurred_at = message["datetime"].isoformat(timespec="minutes")
    base = "|".join([source_id, occurred_at, canonical_sender(message.get("raw_sender")), content_hash])
    fingerprint = hashlib.sha256(f"{base}|{occurrence}".encode("utf-8")).hexdigest()
    return {
        "sourceId": source_id,
        "occurredAt": occurred_at,
        "date": message["date"],
        "time": message["time"],
        "sender": message.get("raw_sender"),
        "senderCanonical": canonical_sender(message.get("raw_sender")),
        "senderKind": sender_kind(message.get("raw_sender")),
        "contentHash": content_hash,
        "occurrence": occurrence,
        "fingerprint": fingerprint,
        "lineHint": message.get("line_start"),
    }


def iter_whatsapp_messages(path: Path) -> Iterator[dict[str, Any]]:
    current: dict[str, Any] | None = None
    message_number = 0

    def finish() -> dict[str, Any] | None:
        nonlocal current, message_number
        if current is None:
            return None
        current["message"] = normalized_message(current.get("message"))
        current["has_media"] = "<Mídia oculta>" in current["message"] or "<Midia oculta>" in current["message"]
        current["media_count"] = current["message"].count("<Mídia oculta>") + current["message"].count("<Midia oculta>")
        message_number += 1
        current["message_id"] = f"msg_{message_number:06d}"
        result = current
        current = None
        return result

    with path.open("r", encoding="utf-8-sig", errors="strict") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\r\n")
            match = MESSAGE_RE.match(line)
            if match:
                completed = finish()
                if completed is not None:
                    yield completed
                body = match.group("body")
                raw_sender = None
                text = body
                system = True
                if ": " in body and not is_system_body(body):
                    raw_sender, text = body.split(": ", 1)
                    system = False
                dt = parse_datetime(match.group("date"), match.group("time"))
                current = {
                    "line_start": line_number,
                    "datetime": dt,
                    "date": dt.date().isoformat(),
                    "time": dt.strftime("%H:%M"),
                    "raw_sender": raw_sender,
                    "message": text,
                    "is_system": system,
                    "has_media": False,
                    "media_count": 0,
                }
            elif current is not None:
                current["message"] = f"{current['message']}\n{line}"
    completed = finish()
    if completed is not None:
        yield completed


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_file(path: Path, source_id: str, checkpoint: dict[str, Any] | None, collect: bool) -> dict[str, Any]:
    occurrences: Counter[str] = Counter()
    checkpoint_fingerprint = str((checkpoint or {}).get("fingerprint") or "")
    found = not checkpoint_fingerprint
    found_count = 0
    recognized = 0
    sender_messages = 0
    new_messages: list[dict[str, Any]] = []
    last_new_checkpoint: dict[str, Any] | None = None
    for message in iter_whatsapp_messages(path):
        recognized += 1
        if message.get("is_system") or not message.get("raw_sender"):
            continue
        sender_messages += 1
        content_hash = hashlib.sha256(normalized_message(message.get("message")).encode("utf-8", errors="replace")).hexdigest()
        signature = "|".join([source_id, message["datetime"].isoformat(timespec="minutes"), canonical_sender(message.get("raw_sender")), content_hash])
        occurrences[signature] += 1
        identity = message_identity(message, source_id, occurrences[signature])
        message["message_fingerprint"] = identity["fingerprint"]
        message["checkpoint"] = identity
        if checkpoint_fingerprint and identity["fingerprint"] == checkpoint_fingerprint:
            found = True
            found_count += 1
            continue
        if found:
            last_new_checkpoint = identity
            if collect:
                new_messages.append(message)
    if recognized == 0:
        raise ValueError("Nenhuma mensagem no formato WhatsApp suportado foi encontrada.")
    if sender_messages == 0:
        raise ValueError("O arquivo não contém mensagens com remetente identificável.")
    if checkpoint_fingerprint and found_count == 0:
        raise ValueError("O checkpoint atual não foi localizado com segurança no arquivo.")
    if checkpoint_fingerprint and found_count > 1:
        raise ValueError("O checkpoint aparece mais de uma vez no arquivo; importação cancelada.")
    return {
        "fileHash": file_hash(path),
        "totalMessages": recognized,
        "senderMessages": sender_messages,
        "newMessageCount": len(new_messages) if collect else sum(1 for _ in ()),
        "newMessages": new_messages,
        "checkpointFound": found_count == 1 if checkpoint_fingerprint else True,
        "checkpointFinal": last_new_checkpoint or checkpoint,
    }


def analyze_file(path: Path, source_id: str, checkpoint: dict[str, Any] | None) -> dict[str, Any]:
    # A prévia mantém apenas o trecho novo em memória; nenhuma regra de classificação é executada.
    result = scan_file(path, source_id, checkpoint, collect=True)
    result["newMessageCount"] = len(result.pop("newMessages"))
    return result


def load_json(path: Path | None, default: Any) -> Any:
    if not path or not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def merge_runtime_neighborhoods(location_dicts: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    for item in rows:
        name = str(item.get("nome") or item.get("bairro") or "").strip()
        if not name:
            continue
        key = normalize_key(name)
        neighborhood = {
            "bairro": name,
            "regiao": item.get("regiao"),
            "zona": item.get("zona"),
            "latitude": item.get("latitude"),
            "longitude": item.get("longitude"),
        }
        location_dicts["by_key"][key] = neighborhood
        if not any(normalize_key(row.get("bairro")) == key for row in location_dicts["bairros"]):
            location_dicts["bairros"].append(neighborhood)
        for alias in item.get("aliases") or []:
            alias_key = normalize_key(str(alias))
            if alias_key:
                location_dicts["aliases"][alias_key] = name


def assign_stable_senders(messages: list[dict[str, Any]], directory: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_raw = {canonical_sender(item.get("raw_sender")): item for item in directory if canonical_sender(item.get("raw_sender"))}
    by_id = {str(item.get("sender_id")): item for item in directory if item.get("sender_id")}
    updates: dict[str, dict[str, Any]] = {}
    for message in messages:
        raw = str(message.get("raw_sender") or "").strip()
        key = canonical_sender(raw)
        known = by_raw.get(key)
        if known:
            sender_id = str(known["sender_id"])
            entry = known
        else:
            sender_id = f"snd_{hashlib.sha256(key.encode('utf-8')).hexdigest()[:12]}"
            phone = normalize_sender_phone(raw)
            name = raw if not phone else phone
            entry = {
                "sender_id": sender_id,
                "raw_sender": raw,
                "nome_corretor": name,
                "telefone_corretor": phone,
                "fonte_nome": "txt",
            }
            by_raw[key] = entry
            if sender_id not in by_id:
                updates[sender_id] = entry
                by_id[sender_id] = entry
        message["sender_id"] = sender_id
        message["sender_name"] = entry.get("nome_corretor") or raw
        message["sender_phone"] = entry.get("telefone_corretor") or ""
    return sorted(updates.values(), key=lambda item: item["sender_id"])


def candidate_neighborhood(text: str, known_keys: set[str]) -> str | None:
    match = EXPLICIT_NEIGHBORHOOD_RE.search(text or "")
    if not match:
        return None
    words = re.sub(r"\s+", " ", match.group("name")).strip(" .,:;-/").split()
    selected: list[str] = []
    for word in words[:4]:
        if normalize_key(word) in NEIGHBORHOOD_STOP_WORDS:
            break
        selected.append(word)
    candidate = " ".join(selected).strip()
    if len(candidate) < 3 or normalize_key(candidate) in known_keys:
        return None
    return candidate.title()


def make_review(kind: str, record: dict[str, Any], candidate: str | None = None) -> dict[str, Any]:
    key = "|".join([kind, str(record.get("id")), normalize_key(candidate or "")])
    return {
        "id": f"rev_{hashlib.sha256(key.encode('utf-8')).hexdigest()[:20]}",
        "type": kind,
        "status": "pendente",
        "candidateName": candidate,
        "opportunityId": record.get("id"),
        "occurredAt": record.get("data_inicio"),
        "senderId": record.get("sender_id"),
        "sender": record.get("nome_corretor") or record.get("telefone_corretor") or record.get("sender_id"),
        "extractionStatus": record.get("status_extracao"),
        "sourceMessageMasked": mask_private_text(str(record.get("texto_original") or "")),
    }


def process_file(
    path: Path,
    source_id: str,
    checkpoint: dict[str, Any] | None,
    import_id: str,
    neighborhoods_path: Path | None,
    directory_path: Path | None,
) -> dict[str, Any]:
    scan = scan_file(path, source_id, checkpoint, collect=True)
    messages = scan.pop("newMessages")
    scan["newMessageCount"] = len(messages)
    if not messages:
        return {**scan, "opportunities": [], "directoryUpdates": [], "messageFingerprints": [], "reviews": [], "reviewMessages": []}

    directory = load_json(directory_path, [])
    directory_updates = assign_stable_senders(messages, directory)
    location_dicts = load_location_dictionaries(ROOT / "dictionaries")
    runtime_neighborhoods = load_json(neighborhoods_path, [])
    merge_runtime_neighborhoods(location_dicts, runtime_neighborhoods)
    property_terms = load_property_terms(ROOT / "dictionaries" / "tipos_imoveis.json")
    economic_dicts = load_economic_dictionaries(ROOT / "dictionaries")
    batch_id = import_id

    records: list[dict[str, Any]] = []
    for block in group_messages(messages):
        record = build_record(block, batch_id, location_dicts, property_terms, economic_dicts)
        source_ids = [str(item.get("message_fingerprint")) for item in block.get("messages") or []]
        record["source_message_ids"] = source_ids
        record["id"] = f"opp_{hashlib.sha256('|'.join(source_ids).encode('utf-8')).hexdigest()[:20]}"
        records.append(record)
    records = dedupe_records(records)

    known_keys = set(location_dicts["by_key"]) | set(location_dicts["aliases"])
    reviews: list[dict[str, Any]] = []
    opportunities: list[dict[str, Any]] = []
    review_messages: list[dict[str, Any]] = []
    for record in records:
        if record.get("status_extracao") != "RUIDO":
            public = _public_opportunity(record)
            public.update({
                "id": record["id"],
                "source_id": source_id,
                "import_id": import_id,
                "source_message_ids": record.get("source_message_ids") or [],
                "dedupe_key": record.get("dedupe_key"),
            })
            opportunities.append(public)
            review_messages.append({
                "opportunityId": record["id"],
                "occurredAt": record.get("data_inicio"),
                "senderId": record.get("sender_id"),
                "sourceMessageMasked": mask_private_text(str(record.get("texto_original") or "")),
            })
            candidate = None if record.get("bairro_normalizado") else candidate_neighborhood(str(record.get("texto_original") or ""), known_keys)
            if candidate:
                reviews.append(make_review("bairro_novo", record, candidate))
            if record.get("status_extracao") in {"AMBIGUO", "REVISAO_MANUAL"}:
                reviews.append(make_review("classificacao", record))

    return {
        **scan,
        "opportunities": opportunities,
        "directoryUpdates": directory_updates,
        "messageFingerprints": [str(item["message_fingerprint"]) for item in messages],
        "reviews": reviews,
        "reviewMessages": review_messages,
    }


def parse_checkpoint(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    parsed = json.loads(value)
    return parsed if parsed else None


def main() -> None:
    parser = argparse.ArgumentParser(description="NEXUM incremental WhatsApp ingestion")
    parser.add_argument("command", choices=["preview", "process"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--source-id", default=SOURCE_ID)
    parser.add_argument("--checkpoint")
    parser.add_argument("--import-id", default="preview")
    parser.add_argument("--neighborhoods")
    parser.add_argument("--sender-directory")
    args = parser.parse_args()
    path = Path(args.input)
    if not path.exists() or path.suffix.lower() != ".txt":
        raise ValueError("Informe um arquivo TXT válido.")
    checkpoint = parse_checkpoint(args.checkpoint)
    try:
        if args.command == "preview":
            result = analyze_file(path, args.source_id, checkpoint)
        else:
            result = process_file(
                path,
                args.source_id,
                checkpoint,
                args.import_id,
                Path(args.neighborhoods) if args.neighborhoods else None,
                Path(args.sender_directory) if args.sender_directory else None,
            )
    except UnicodeDecodeError:
        print("O arquivo deve estar codificado em UTF-8, como o TXT exportado pelo WhatsApp.", file=sys.stderr)
        raise SystemExit(2)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
