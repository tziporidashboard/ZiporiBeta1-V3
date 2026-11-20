"""Package the approved CSV and its ID-scoped display metadata for the dashboard.

Pass the private approved CSV, the audited iNaturalist capture directory and the
audited production capture directory. The source files are read only.
"""

import argparse
import csv
from hashlib import sha256
import io
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
APPROVED_SHA = "5d2561d898ab62a5e846cd8ad649801db308d295785480452059581f6e69c52c"
OCTOBER_SOURCE = "458236338a35c2a8ae43a5724e5b031bcf720d02a66bed6a96d717d9ea4edf14"
PRODUCTION = "87bcf7de2370442dd398646281f311c7f318588b"
CSV_FILE = "zipori-observations-2026-11-20.csv"
METADATA_FILE = "zipori-observation-metadata-2026-11-20.json"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return sha256(value).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_jsonl(path):
    with path.open(encoding="utf-8-sig") as handle:
        return [json.loads(line) for line in handle]


def read_dashboard(directory):
    content = (directory / "dashboard.json").read_bytes()
    manifest = read_json(directory / "dashboard-manifest.json")
    require(manifest["ref"] == PRODUCTION and digest(content) == manifest["dashboard_sha256"],
            "Unexpected production capture")
    observations = json.loads(content)
    result = {row["composite_id"]: row for row in observations}
    require(len(result) == len(observations) == 16187, "Unexpected production observations")
    return result


def read_public_inat(directory, direct_file):
    snapshot = read_json(directory / "snapshot.json")
    capture = directory / "project-observations.jsonl"
    require(snapshot["complete"] and digest(capture.read_bytes()) == snapshot["scans"]["project"]["sha256"],
            "The public iNaturalist snapshot is incomplete or changed")
    direct = read_jsonl(direct_file)
    require(len(direct) == 117 and len({row["query"] for row in direct}) == len(direct),
            "Unexpected public follow-up capture")
    rows = read_jsonl(capture) + [item["observation"] for item in direct if item["observation"]]
    result = {}
    numbers = {}
    for row in rows:
        uuid, obs_id = row["uuid"], row["id"]
        require(uuid not in result or result[uuid] == row, f"Conflicting public evidence for {uuid}")
        require(obs_id not in numbers or numbers[obs_id] == uuid, f"Conflicting UUID for {obs_id}")
        result[uuid], numbers[obs_id] = row, uuid
    return result, snapshot["finished_utc"]


def retained_evidence(previous, uuid, numeric_id):
    old = previous.get("source_metadata")
    if not old:
        return None
    verification = old.get("verification")
    if verification:
        require(old["file_sha256"] == OCTOBER_SOURCE and verification["uuid"] == uuid
                and str(verification["inaturalist_id"]) == numeric_id
                and verification["scientific_name"] == previous["scientific_name"]
                and type(verification["taxon_id"]) is int and verification["taxon_id"] > 0,
                f"Unexpected October reference for {numeric_id}")
        return {"kind": "verified-csv", "taxonId": verification["taxon_id"]}
    require(old["file_name"] == "all observations until September 2026 (3).xlsx"
            and old["values"]["originalRecordId"] == numeric_id
            and old["values"]["scientific_name"] == previous["scientific_name"],
            f"Unexpected September reference for {numeric_id}")
    return {"kind": "september"}


def package(args):
    source = args.source.read_bytes()
    require(digest(source) == APPROVED_SHA, "The approved source CSV differs from its recorded hash")
    reader = csv.DictReader(io.StringIO(source.decode("utf-8-sig"), newline=""), strict=True)
    inputs = list(reader)
    require(len(inputs) == 16107 and len(reader.fieldnames) == len(set(reader.fieldnames)) == 22,
            "Unexpected approved CSV shape")
    previous = read_dashboard(args.production)
    public, checked_at = read_public_inat(args.inat, args.direct)
    metadata, used_ids = {}, set()
    withheld = 0

    for row in inputs:
        require(None not in row and None not in row.values(), "Malformed approved CSV row")
        if row["user_verified"] == "expert":
            key = "expert_" + row["composite_id"]
            require(previous[key]["professional_metadata"]["values"] == row,
                    f"MERLIN source changed for {key}")
        else:
            require(row["user_verified"] == "contributor", "Unrecognized source")
            uuid = row["originalRecordId"]
            api = public[uuid]
            obs_id = str(api["id"])
            key = "inat_" + obs_id
            old = previous[key]
            historical_uuid = (old.get("historical_inat_reference") or {}).get("uuid")
            require(not historical_uuid or historical_uuid.lower() == uuid,
                    f"Production UUID differs for {obs_id}")
            require(uuid not in metadata and api["user"]["login"] == row["user_login"],
                    f"Duplicate UUID or observer mismatch for {obs_id}")
            hidden = api["obscured"] or any(
                api[field] not in (None, "open") for field in ("geoprivacy", "taxon_geoprivacy")
            )
            if hidden:
                row["latitude"] = row["longitude"] = ""
                withheld += 1
            else:
                point = api.get("geojson") or {}
                require(point.get("type") == "Point"
                        and list(map(float, (row["longitude"], row["latitude"]))) == point["coordinates"],
                        f"Unverified public coordinates for {obs_id}")
            item = {
                "id": obs_id,
                "userCategory": old["user_category"],
                "userSubcategory": old["user_subcategory"],
                "scientificName": old["scientific_name"],
                "commonName": old.get("common_name") or "",
                "iconicTaxonName": old["iconic_taxon_name"],
                "taxonOrderName": old["taxon_order_name"],
            }
            if old.get("establishment_means"):
                item["establishmentMeans"] = old["establishment_means"]
            if hidden:
                item["locationWithheld"] = True
            evidence = retained_evidence(old, uuid, obs_id)
            if evidence:
                item["taxonomyEvidence"] = evidence
            metadata[uuid] = item
        require(key not in used_ids, f"Duplicate dashboard ID {key}")
        used_ids.add(key)

    require(len(metadata) == 12014 and len(used_ids) == 16107 and len(previous.keys()-used_ids) == 80
            and withheld == 53, "Unexpected ID coverage or privacy counts")
    content = io.StringIO(newline="")
    writer = csv.DictWriter(content, reader.fieldnames)
    writer.writeheader()
    writer.writerows(inputs)
    safe_csv = content.getvalue().encode("utf-8-sig")
    sidecar = {
        "version": 1,
        "approvedSha256": APPROVED_SHA,
        "csvSha256": digest(safe_csv),
        "privacyCheckedAt": checked_at,
        "locationsWithheld": withheld,
        "inaturalist": metadata,
        "displayOrder": [key for key in previous if key in used_ids],
    }

    output = ROOT / "dashboard-public"
    output.mkdir(exist_ok=True)
    (output / CSV_FILE).write_bytes(safe_csv)
    (output / METADATA_FILE).write_text(
        json.dumps(sidecar, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    for asset in ("favicon.ico", "monitoring-areas.geojson"):
        (output / asset).write_bytes((ROOT / "public" / asset).read_bytes())
    print(f"{len(used_ids)} observations, {withheld} locations withheld, {len(previous.keys()-used_ids)} legacy IDs excluded")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--inat", type=Path, required=True)
    parser.add_argument("--direct", type=Path, required=True)
    parser.add_argument("--production", type=Path, required=True)
    package(parser.parse_args())
