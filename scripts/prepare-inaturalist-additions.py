"""Rebuild the approved September 2026 batch without changing historical sources.

Usage: python scripts/prepare-inaturalist-additions.py INPUT.xlsx [--write]
Without --write, verifies that the committed JSON is exactly reproducible.
Uses only Python's standard library. The workbook is never needed at runtime.
"""

import argparse
from collections import Counter
import csv
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/inaturalist-september-2026-additions.json"
APPROVED_WORKBOOK_SHA256 = "f261a8c4abeed8909fee64a1947c76b7535e00177ee3381c258c5d56582df16d"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
HEADERS = [
    "composite_id", "originalRecordId", "source_url", "observed_on", "latitude",
    "longitude", "quality_grade", "user_login", "user_name", "user_verified",
    "user_category", "user_category_he", "user_subcategory", "user_subcategory_he",
    "scientific_name", "hebrew_name", "english_name", "taxa_category_he",
    "taxa_category_en", "is_invasive", "is_rare", "is_generic",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_workbook(path):
    """Read literal OOXML values, retaining original decimal strings and NULLs."""
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        props = workbook.find("s:workbookPr", NS)
        require(props is None or props.get("date1904", "0") in ("0", "false"),
                "Expected the verified 1900 Excel date system")
        sheets = [sheet for sheet in workbook.findall("s:sheets/s:sheet", NS)
                  if sheet.get("name") == "all observations until Septembe"]
        require(len(sheets) == 1, "Approved source worksheet not found")
        relationships = {r.get("Id"): r.get("Target") for r in
                         ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        rel_id = sheets[0].get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = relationships[rel_id]
        target = target.lstrip("/") if target.startswith("/") else "xl/" + target
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(t.text or "" for t in node.findall(".//s:t", NS))
                      for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
        rows = []
        for row in ET.fromstring(archive.read(target)).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row.findall("s:c", NS):
                require(cell.find("s:f", NS) is None, "Formula found in source data")
                kind = cell.get("t", "n")
                require(kind in ("s", "n", "b", "inlineStr"), "Unsupported cell type")
                value = cell.findtext("s:v", default="", namespaces=NS)
                if kind == "s":
                    value = shared[int(value)]
                elif kind == "inlineStr":
                    value = "".join(t.text or "" for t in cell.findall(".//s:t", NS))
                cells[re.sub(r"\d", "", cell.get("r"))] = value
            if any(cells.values()):
                rows.append((int(row.get("r")), cells))
        columns = rows[0][1]
        require(list(columns.values()) == HEADERS, "Source headers differ from the approved schema")
        return sheets[0].get("name"), [
            {"excel_row": number, "values": {name: cells.get(col, "") for col, name in columns.items()}}
            for number, cells in rows[1:]
        ]


def recorded_datetime(serial):
    """Decode a timezone-free Excel calendar value at its verified second precision."""
    seconds = Decimal(serial) * 86400
    whole_seconds = seconds.to_integral_value(rounding=ROUND_HALF_UP)
    # Reject meaningful subsecond data instead of silently discarding it. All
    # approved values are integral seconds with <0.4 microsecond storage noise.
    require(abs(seconds - whole_seconds) < Decimal("0.000001"), "Unexpected subsecond precision")
    require(Decimal(serial) > 60, "Unsupported early Excel serial date")
    value = datetime(1899, 12, 30) + timedelta(seconds=int(whole_seconds))
    return value.strftime("%d/%m/%Y"), value.strftime("%H:%M:%S")


def build(path):
    require(sha(path) == APPROVED_WORKBOOK_SHA256, "Workbook differs from the approved updated file")
    sheet, rows = read_workbook(path)
    require(len(rows) == 12343, "Unexpected workbook row count")
    historical_path = ROOT / "public/Until_June26.csv"
    with historical_path.open(encoding="utf-8-sig", newline="") as stream:
        historical = list(csv.DictReader(stream))
    existing_ids = {r["id"].strip() for r in historical}
    require(len(historical) == len(existing_ids) == 10317, "Historical iNaturalist IDs changed")
    inat = [row for row in rows if row["values"]["originalRecordId"] not in ("", "NULL")]
    ids = [row["values"]["originalRecordId"] for row in inat]
    require(len(ids) == len(set(ids)) == 9989, "Nonunique or unexpected originalRecordId values")
    require(all(re.fullmatch(r"[1-9]\d*", value) for value in ids), "Invalid iNaturalist ID")
    additions = sorted((row for row in inat if row["values"]["originalRecordId"] not in existing_ids),
                       key=lambda row: int(row["values"]["originalRecordId"]))
    require(len(additions) == 979, "Unexpected addition count; do not adjust records to force totals")
    for row in additions:
        row["observed_date"], row["observed_time"] = recorded_datetime(row["values"]["observed_on"])
    require(Counter(r["values"]["quality_grade"] for r in additions) ==
            Counter(research=518, needs_id=431, casual=30), "Unexpected quality distribution")
    return {
        "schemaVersion": 1,
        "source": {
            "fileName": path.name,
            "sha256": sha(path),
            "sheetName": sheet,
            "idColumn": "originalRecordId",
            "historicalFile": "public/Until_June26.csv",
            "historicalSha256": sha(historical_path),
            "policy": "Add only absent original IDs. Preserve historical data. Use Excel groups for new records.",
            "distinctEncounterIds": ["264804474", "401017628", "401017800"],
            "encounterNote": "Potential repeated biological encounters retained as distinct source observation records by explicit approval.",
        },
        "records": additions,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    payload = build(args.workbook)
    content = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if args.write:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != content:
            OUTPUT.write_bytes(content)
    else:
        require(OUTPUT.read_bytes() == content, "Stored additions differ from the verified source")
    print(json.dumps({"records": len(payload["records"]), "sha256": hashlib.sha256(content).hexdigest(),
                      "mode": "write" if args.write else "check"}))


if __name__ == "__main__":
    main()
