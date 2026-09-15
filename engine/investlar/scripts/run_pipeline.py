from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.build_public_json import write_public_jsons
from scripts.classify_market_operation import classify_market_operation
from scripts.classify_property_economics import classificar_padrao_imovel, load_economic_dictionaries
from scripts.dedupe_records import dedupe_records
from scripts.extract_features import extract_features
from scripts.extract_intent import classify_intent
from scripts.extract_location import extract_location, load_location_dictionaries
from scripts.extract_property_type import extract_property_type, load_property_terms
from scripts.extract_values import extract_values
from scripts.group_blocks import group_messages
from scripts.normalize_text import normalize_text
from scripts.parse_vcf import parse_vcfs
from scripts.parse_whatsapp import locate_conversation_txt, parse_whatsapp_txt
from scripts.score_confidence import score_record


RULESET_VERSION = "ruleset_0.1"
PROJECT_VERSION = "0.2.0"


def main() -> None:
    parser = argparse.ArgumentParser(description="Investlar local-first ETL pipeline")
    parser.add_argument("--input", required=True, help="Pasta exportada do WhatsApp")
    parser.add_argument("--output", default="public/data", help="Pasta de JSONs públicos")
    parser.add_argument("--dictionaries", default="dictionaries", help="Pasta de dicionários")
    parser.add_argument("--diagnostics", default="data_processed/extraction_diagnostics.local.json")
    args = parser.parse_args()

    summary = run_pipeline(
        input_dir=Path(args.input),
        output_dir=Path(args.output),
        dictionaries_dir=Path(args.dictionaries),
        diagnostics_path=Path(args.diagnostics),
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def run_pipeline(
    input_dir: Path,
    output_dir: Path,
    dictionaries_dir: Path,
    diagnostics_path: Path,
) -> dict[str, Any]:
    txt_path = locate_conversation_txt(input_dir)
    input_hash = calculate_input_hash(input_dir)
    batch_id = datetime.now().strftime("%Y_%m_%d_whatsapp_cg")

    vcf_info = parse_vcfs(input_dir)
    messages = parse_whatsapp_txt(txt_path)
    messages.sort(key=lambda item: (item["datetime"], item["line_start"]))
    sender_directory = assign_sender_ids(messages, vcf_info)

    blocks = group_messages(messages)
    location_dicts = load_location_dictionaries(dictionaries_dir)
    property_terms = load_property_terms(dictionaries_dir / "tipos_imoveis.json")
    economic_dicts = load_economic_dictionaries(dictionaries_dir)

    records: list[dict[str, Any]] = []
    for block in blocks:
        record = build_record(block, batch_id, location_dicts, property_terms, economic_dicts)
        records.append(record)

    records = dedupe_records(records)
    for index, record in enumerate(records, start=1):
        record["id"] = f"blk_{index:06d}"

    manifest = build_manifest(messages, records, batch_id, input_hash, txt_path, vcf_info)
    public_summary = write_public_jsons(records, output_dir, manifest, sender_directory)
    write_diagnostics(diagnostics_path, records, public_summary, vcf_info)
    return {
        "batch_id": batch_id,
        "txt_file": str(txt_path),
        "output_dir": str(output_dir),
        "total_messages": len(messages),
        "total_blocks": len(records),
        "total_opportunities": public_summary["manifest"]["total_opportunities"],
        "quality": public_summary["quality"],
    }


def assign_sender_ids(messages: list[dict[str, Any]], vcf_info: dict[str, Any]) -> list[dict[str, Any]]:
    sender_map: dict[str, str] = {}
    sender_directory: dict[str, dict[str, Any]] = {}
    phone_to_name = vcf_info.get("phone_to_name", {})
    for message in messages:
        sender = message.get("raw_sender")
        if not sender:
            continue
        if sender not in sender_map:
            sender_map[sender] = f"snd_{len(sender_map) + 1:04d}"
        sender_id = sender_map[sender]
        phone = normalize_sender_phone(sender)
        name = resolve_sender_name(sender, phone, phone_to_name)
        display_name = name or phone or str(sender)
        message["sender_id"] = sender_id
        message["sender_name"] = display_name
        message["sender_phone"] = phone
        sender_directory[sender_id] = {
            "sender_id": sender_id,
            "raw_sender": sender,
            "nome_corretor": display_name,
            "telefone_corretor": phone,
            "fonte_nome": "vcf" if phone and phone_to_name.get(phone) else "txt",
        }
    return list(sender_directory.values())


def normalize_sender_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        return ""
    if len(digits) in {10, 11}:
        return f"55{digits}"
    if len(digits) >= 12:
        return digits
    return ""


def resolve_sender_name(raw_sender: str, phone: str, phone_to_name: dict[str, str]) -> str:
    if phone:
        candidates = [phone]
        if phone.startswith("55"):
            candidates.append(phone[2:])
        for candidate in candidates:
            if phone_to_name.get(candidate):
                return str(phone_to_name[candidate]).strip()
        return ""
    return str(raw_sender or "").strip()


def build_record(
    block: dict[str, Any],
    batch_id: str,
    location_dicts: dict[str, Any],
    property_terms: list[dict[str, object]],
    economic_dicts: dict[str, Any],
) -> dict[str, Any]:
    text = block["texto_original"]
    intent = classify_intent(text)
    if intent.intencao_mercado == "RUIDO":
        record = base_record(block, batch_id, text, intent)
        return score_record(record, intent_ambiguous=False)

    normalized = normalize_text(text)
    property_info = extract_property_type(text, property_terms)
    location = extract_location(text, location_dicts)
    values = extract_values(text, intent.intencao_mercado)
    features = extract_features(text)

    record: dict[str, Any] = {
        "id": block["block_id"],
        "batch_id": batch_id,
        "date": block["date"],
        "data_inicio": block["data_inicio"],
        "data_fim": block["data_fim"],
        "sender_id": block.get("sender_id"),
        "nome_corretor": sender_meta(block, "sender_name"),
        "telefone_corretor": sender_meta(block, "sender_phone"),
        "intencao_mercado": intent.intencao_mercado,
        "lado_negociacao": intent.lado_negociacao,
        "confianca_intencao": intent.confianca_intencao,
        "texto_original": text,
        "texto_normalizado": normalized["texto_normalizado"],
        "tem_midia": block.get("tem_midia", False),
        "media_count": block.get("media_count", 0),
        "message_count": block.get("message_count", 0),
        **property_info,
        **location,
        **values,
        **features,
    }
    record.update(classify_market_operation(intent.intencao_mercado))
    record.update(
        classificar_padrao_imovel(
            {
                **record,
                "valor_total": record.get("valor_venda") or record.get("valor_orcamento_maximo") or record.get("valor_repasse_agio"),
                "area_m2": record.get("area_privativa_m2") or record.get("area_terreno_m2"),
                "bairro": record.get("bairro_normalizado"),
                "atributos": {
                    "quartos": record.get("quartos"),
                    "suites": record.get("suites") or 0,
                    "vagas": record.get("vagas_garagem") or 0,
                    "mobiliado": record.get("mobiliado_flag"),
                    "piscina": record.get("piscina_flag"),
                    "condominio_fechado": "condominio fechado" in str(record.get("texto_normalizado") or ""),
                },
            },
            economic_dicts,
        )
    )
    return score_record(record, intent_ambiguous=intent.ambiguous)


def base_record(
    block: dict[str, Any],
    batch_id: str,
    text: str,
    intent: Any,
) -> dict[str, Any]:
    return {
        "id": block["block_id"],
        "batch_id": batch_id,
        "date": block["date"],
        "data_inicio": block["data_inicio"],
        "data_fim": block["data_fim"],
        "sender_id": block.get("sender_id"),
        "nome_corretor": sender_meta(block, "sender_name"),
        "telefone_corretor": sender_meta(block, "sender_phone"),
        "intencao_mercado": intent.intencao_mercado,
        "lado_negociacao": intent.lado_negociacao,
        **classify_market_operation(intent.intencao_mercado),
        "confianca_intencao": intent.confianca_intencao,
        "texto_original": text,
        "texto_normalizado": "",
        "tem_midia": block.get("tem_midia", False),
        "media_count": block.get("media_count", 0),
        "message_count": block.get("message_count", 0),
        "tipo_imovel": "INDEFINIDO",
        "segmento_imovel": "INDEFINIDO",
        "confianca_tipo_imovel": 0.0,
        "cidade_detectada": None,
        "bairro_original": None,
        "bairro_normalizado": None,
        "bairro_id": None,
        "regiao": None,
        "zona": None,
        "latitude": None,
        "longitude": None,
        "localizacao_confianca": 0.0,
        "fora_campina_grande_flag": False,
        "valor_venda": None,
        "valor_locacao": None,
        "valor_condominio": None,
        "valor_iptu": None,
        "valor_entrada": None,
        "valor_saldo": None,
        "valor_parcela": None,
        "valor_repasse_agio": None,
        "valor_orcamento_maximo": None,
        "valor_orcamento_minimo": None,
        "valor_original_texto": None,
        "valor_confianca": 0.0,
        "valor_ambiguidade_flag": False,
        "area_privativa_m2": None,
        "area_terreno_m2": None,
        "quartos": None,
        "suites": None,
        "banheiros": None,
        "vagas_garagem": None,
        "andar": None,
        "mobiliado_flag": False,
        "semi_mobiliado_flag": False,
        "elevador_flag": False,
        "area_lazer_flag": False,
        "piscina_flag": False,
        "condominio_incluso_flag": False,
        "financiavel_flag": False,
        "aceita_permuta_flag": False,
        "nascente_flag": False,
        "tipo_imovel_fisico": "indefinido",
        "segmento_uso": "indefinido",
        "padrao_economico": "indefinido",
        "mcmv_indicio": "nao",
        "mcmv_possivel": "indefinido",
        "faixa_valor": None,
        "valor_m2_estimado": None,
        "confidence_padrao": 0.0,
        "motivos_classificacao": [],
        "status_padrao": "indefinido",
        "tier_mercado": "indefinido",
    }


def sender_meta(block: dict[str, Any], key: str) -> Any:
    messages = block.get("messages") or []
    return messages[0].get(key) if messages else None


def build_manifest(
    messages: list[dict[str, Any]],
    records: list[dict[str, Any]],
    batch_id: str,
    input_hash: str,
    txt_path: Path,
    vcf_info: dict[str, Any],
) -> dict[str, Any]:
    non_system_dates = [message["datetime"].date().isoformat() for message in messages if not message.get("is_system")]
    return {
        "project": "Investlar Market Intelligence",
        "version": PROJECT_VERSION,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "whatsapp_export",
        "batch_id": batch_id,
        "source_hash": input_hash,
        "source_file": txt_path.name,
        "period_start": min(non_system_dates) if non_system_dates else None,
        "period_end": max(non_system_dates) if non_system_dates else None,
        "total_messages": len(messages),
        "total_system_messages": sum(1 for message in messages if message.get("is_system")),
        "total_media_messages": sum(1 for message in messages if message.get("has_media")),
        "total_vcf_files": vcf_info.get("total_vcf_files", 0),
        "total_contacts_vcf": vcf_info.get("total_contacts", 0),
        "total_blocks": len(records),
        "total_opportunities": 0,
        "extractor_version": RULESET_VERSION,
    }


def calculate_input_hash(input_dir: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(input_dir.glob("*")):
        if path.is_file() and path.suffix.lower() in {".txt", ".vcf"}:
            digest.update(path.name.encode("utf-8", errors="replace"))
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
    return digest.hexdigest()


def write_diagnostics(
    diagnostics_path: Path,
    records: list[dict[str, Any]],
    public_summary: dict[str, Any],
    vcf_info: dict[str, Any],
) -> None:
    diagnostics_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "public_summary": public_summary,
        "vcf_summary": {
            "total_vcf_files": vcf_info.get("total_vcf_files", 0),
            "total_contacts": vcf_info.get("total_contacts", 0),
        },
        "top_review_records": [
            {
                "id": item.get("id"),
                "status_extracao": item.get("status_extracao"),
                "intencao_mercado": item.get("intencao_mercado"),
                "bairro_normalizado": item.get("bairro_normalizado"),
                "confianca_total": item.get("confianca_total"),
            }
            for item in records[:50]
        ],
    }
    diagnostics_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
