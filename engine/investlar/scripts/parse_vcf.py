from __future__ import annotations

import re
from pathlib import Path
from typing import Any


TEL_RE = re.compile(r"(?:[^:;]+\.)?TEL[^:]*:(?P<phone>.+)", re.IGNORECASE)
FN_RE = re.compile(r"(?:[^:;]+\.)?FN[^:]*:(?P<name>.+)", re.IGNORECASE)
WA_NAME_RE = re.compile(r"X-WA-BIZ-NAME[^:]*:(?P<name>.+)", re.IGNORECASE)


def _normalize_phone(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def parse_vcf_file(path: str | Path) -> list[dict[str, str]]:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    text = text.replace("END:VCARDBEGIN:VCARD", "END:VCARD\nBEGIN:VCARD")
    contacts: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.upper() == "BEGIN:VCARD":
            current = {}
        elif line.upper() == "END:VCARD":
            if current:
                contacts.append(current)
            current = {}
        else:
            fn_match = FN_RE.match(line)
            wa_name_match = WA_NAME_RE.match(line)
            tel_match = TEL_RE.match(line)
            if fn_match:
                current["name"] = fn_match.group("name").strip()
            elif wa_name_match and not current.get("name"):
                current["name"] = wa_name_match.group("name").strip()
            elif tel_match:
                current["phone"] = _normalize_phone(tel_match.group("phone"))
    return contacts


def parse_vcfs(input_dir: str | Path) -> dict[str, Any]:
    paths = sorted(Path(input_dir).glob("*.vcf"))
    contacts: list[dict[str, str]] = []
    for path in paths:
        contacts.extend(parse_vcf_file(path))
    phone_to_name = {
        item["phone"]: item.get("name", "")
        for item in contacts
        if item.get("phone") and item.get("name")
    }
    return {
        "total_vcf_files": len(paths),
        "total_contacts": len(contacts),
        "phone_to_name": phone_to_name,
    }
