import argparse
import json
from pathlib import Path


VALUE_FIELDS = (
    "valor_venda",
    "valor_locacao",
    "valor_repasse_agio",
    "valor_orcamento_maximo",
    "valor_orcamento_minimo",
    "valor_saldo",
    "valor_parcela",
)


def has_value(item):
    return any(float(item.get(field) or 0) > 0 for field in VALUE_FIELDS)


def is_useful(item):
    return any(
        [
            item.get("operacao_mercado") and item.get("operacao_mercado") != "indefinida",
            item.get("bairro_normalizado"),
            item.get("tipo_imovel") and item.get("tipo_imovel") != "INDEFINIDO",
            item.get("padrao_economico") and item.get("padrao_economico") != "indefinido",
            has_value(item),
            item.get("lado_negociacao") and item.get("lado_negociacao") != "INDEFINIDA",
        ]
    )


def completeness(item):
    checks = [
        bool(item.get("sender_id")),
        bool(item.get("bairro_normalizado")),
        bool(item.get("operacao_mercado") and item.get("operacao_mercado") != "indefinida"),
        bool(item.get("tipo_imovel") and item.get("tipo_imovel") != "INDEFINIDO"),
        bool(item.get("padrao_economico") and item.get("padrao_economico") != "indefinido"),
        has_value(item),
        bool(item.get("latitude") and item.get("longitude")),
    ]
    return round((sum(checks) / len(checks)) * 100, 1)


def is_healthy(item, useful, comp):
    return (
        item.get("status_extracao") in {"VALIDO", "PARCIAL"}
        and useful
        and comp >= 60
        and bool(item.get("sender_id"))
        and not item.get("fora_campina_grande_flag")
    )


def noise_bucket(item, useful):
    if not useful:
        return "Sem contexto imobiliário"
    if item.get("status_extracao") == "REVISAO_MANUAL":
        return "Revisão manual"
    if item.get("status_extracao") == "AMBIGUO":
        return "Operação ambígua"
    if not item.get("bairro_normalizado"):
        return "Sem bairro"
    if not has_value(item):
        return "Sem valor"
    return ""


def broker_name(item):
    return item.get("nome_corretor") or item.get("raw_sender") or item.get("telefone_corretor") or item.get("sender_id")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="public/pilot-data")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    opportunities = json.loads((data_dir / "opportunities.json").read_text(encoding="utf-8"))
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    quality = json.loads((data_dir / "extraction_quality.json").read_text(encoding="utf-8"))
    directory = json.loads((data_dir / "sender_directory.json").read_text(encoding="utf-8"))

    names = {item["sender_id"]: broker_name(item) for item in directory if item.get("sender_id")}
    rows = []
    for item in opportunities:
        useful = is_useful(item)
        comp = completeness(item)
        healthy = is_healthy(item, useful, comp)
        date_value = item.get("data_inicio") or ""
        rows.append(
            {
                "date": date_value,
                "month": date_value[:7],
                "sender": item.get("sender_id") or "",
                "broker": names.get(item.get("sender_id"), item.get("sender_id") or "Sem corretor"),
                "bairro": item.get("bairro_normalizado") or "",
                "operation": item.get("operacao_mercado") or "indefinida",
                "type": item.get("tipo_imovel") or "INDEFINIDO",
                "pattern": item.get("padrao_economico") or "indefinido",
                "status": item.get("status_extracao") or "RUIDO",
                "useful": useful,
                "healthy": healthy,
                "completion": comp,
                "noise": noise_bucket(item, useful),
            }
        )

    output = {
        "manifest": manifest,
        "quality": quality,
        "rows": rows,
    }
    (data_dir / "curation_metrics.json").write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
