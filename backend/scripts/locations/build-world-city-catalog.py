#!/usr/bin/env python3
"""Build Satori's offline city catalog from a pinned world-cities snapshot.

The public world-cities CSV is the catalog whitelist and administrative-name
source. GeoNames' matching dump enriches those rows with stable IDs, IANA time
zones, population, and localized aliases. China is intentionally reduced to
province/prefecture administrative seats, using the cities1000 dump so small
prefecture seats are not lost to the global 15,000-person threshold.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import tempfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path


WORLD_CITIES_COMMIT = "55bcdd6387eb17e3b12ef56860e42f34c30178f7"
WORLD_CITIES_BASE = (
    "https://raw.githubusercontent.com/joelacus/world-cities/"
    f"{WORLD_CITIES_COMMIT}"
)
DEFAULT_URLS = {
    "world_cities": f"{WORLD_CITIES_BASE}/world_cities_15000.csv",
    "world_cities_admin": (
        f"{WORLD_CITIES_BASE}/"
        "world_cities_15000_%28including_all_states_and_counties%29.csv"
    ),
    "geonames_15000": "https://download.geonames.org/export/dump/cities15000.zip",
    "geonames_1000": "https://download.geonames.org/export/dump/cities1000.zip",
}
HAN_NAME = re.compile(r"^[\u3400-\u9fff·]+$")
CHINA_ADMIN_SEAT_CODES = {"PPLC", "PPLA", "PPLA2"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--world-cities", type=Path)
    parser.add_argument("--world-cities-admin", type=Path)
    parser.add_argument("--geonames-15000-zip", type=Path)
    parser.add_argument("--geonames-1000-zip", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/locations/world-cities.v1.json.gz"),
    )
    return parser.parse_args()


def download(url: str, destination: Path) -> Path:
    request = urllib.request.Request(url, headers={"User-Agent": "satori-location-catalog/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        destination.write_bytes(response.read())
    return destination


def source_path(provided: Path | None, url: str, temp_dir: Path, filename: str) -> Path:
    return provided if provided is not None else download(url, temp_dir / filename)


def decimal_key(value: str) -> str:
    normalized = Decimal(value).normalize()
    return format(normalized, "f")


def city_key(country: str, name: str, latitude: str, longitude: str) -> tuple[str, str, str, str]:
    return country, name, decimal_key(latitude), decimal_key(longitude)


def read_world_city_sources(
    basic_path: Path, admin_path: Path
) -> tuple[set[tuple[str, str, str, str]], dict[tuple[str, str, str, str], str]]:
    with basic_path.open(encoding="utf-8-sig", newline="") as source:
        whitelist = {
            city_key(row["country"], row["name"], row["lat"], row["lng"])
            for row in csv.DictReader(source)
        }
    with admin_path.open(encoding="utf-8-sig", newline="") as source:
        states = {
            city_key(row["country"], row["name"], row["lat"], row["lng"]): row["state"].strip()
            for row in csv.DictReader(source)
        }
    return whitelist, states


def read_geonames(archive_path: Path, member: str):
    with zipfile.ZipFile(archive_path) as archive:
        with archive.open(member) as raw:
            for line in io.TextIOWrapper(raw, encoding="utf-8"):
                fields = line.rstrip("\n").split("\t")
                if len(fields) < 19:
                    continue
                yield {
                    "id": fields[0],
                    "name": fields[1],
                    "ascii_name": fields[2],
                    "alternate_names": fields[3].split(",") if fields[3] else [],
                    "latitude": fields[4],
                    "longitude": fields[5],
                    "feature_code": fields[7],
                    "country": fields[8],
                    "admin1_code": fields[10],
                    "population": int(fields[14] or 0),
                    "timezone": fields[17],
                }


def han_names(names: list[str]) -> list[str]:
    unique = {name.strip() for name in names if 1 < len(name.strip()) <= 12 and HAN_NAME.fullmatch(name.strip())}
    return sorted(unique, key=lambda value: (len(value), value))[:6]


def make_record(row: dict[str, object], state: str) -> list[object]:
    return [
        f"geonames:{row['id']}",
        row["name"],
        row["ascii_name"],
        han_names(row["alternate_names"]),
        state,
        row["country"],
        row["timezone"],
        float(str(row["latitude"])),
        float(str(row["longitude"])),
        row["population"],
    ]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_catalog(
    basic_path: Path,
    admin_path: Path,
    geonames_15000_path: Path,
    geonames_1000_path: Path,
) -> dict[str, object]:
    whitelist, states = read_world_city_sources(basic_path, admin_path)
    matched_keys: set[tuple[str, str, str, str]] = set()
    records_by_id: dict[str, list[object]] = {}
    china_admin1_names: dict[str, Counter[str]] = defaultdict(Counter)

    for row in read_geonames(geonames_15000_path, "cities15000.txt"):
        key = city_key(
            str(row["country"]),
            str(row["name"]),
            str(row["latitude"]),
            str(row["longitude"]),
        )
        if key not in whitelist:
            continue
        matched_keys.add(key)
        state = states.get(key, "")
        if row["country"] == "CN" and state:
            china_admin1_names[str(row["admin1_code"])][state] += 1
        if row["country"] != "CN":
            record = make_record(row, state)
            records_by_id[str(record[0])] = record

    unmatched = len(whitelist - matched_keys)
    if unmatched > 50:
        raise RuntimeError(f"world-cities rows unmatched in GeoNames dump: {unmatched}")

    inferred_china_states = {
        code: counts.most_common(1)[0][0] for code, counts in china_admin1_names.items()
    }
    china_count = 0
    for row in read_geonames(geonames_1000_path, "cities1000.txt"):
        if row["country"] != "CN" or row["feature_code"] not in CHINA_ADMIN_SEAT_CODES:
            continue
        state = inferred_china_states.get(str(row["admin1_code"]), "")
        record = make_record(row, state)
        records_by_id[str(record[0])] = record
        china_count += 1

    records = sorted(
        records_by_id.values(),
        key=lambda value: (str(value[5]), -int(value[9]), str(value[1]), str(value[0])),
    )
    invalid_timezones = [record[0] for record in records if not record[6]]
    if invalid_timezones:
        raise RuntimeError(f"records without timezone: {len(invalid_timezones)}")

    return {
        "metadata": {
            "schemaVersion": "1.0.0",
            "catalogVersion": f"world-cities/{WORLD_CITIES_COMMIT[:12]}+geonames",
            "sourceRepository": "https://github.com/joelacus/world-cities",
            "sourceCommit": WORLD_CITIES_COMMIT,
            "license": "CC-BY-4.0",
            "globalPopulationThreshold": 15000,
            "chinaScope": "PPLC,PPLA,PPLA2 from cities1000",
            "locationCount": len(records),
            "chinaLocationCount": china_count,
            "unmatchedWorldCitiesRows": unmatched,
            "sourceSha256": {
                "worldCities": sha256(basic_path),
                "worldCitiesAdmin": sha256(admin_path),
                "geonames15000": sha256(geonames_15000_path),
                "geonames1000": sha256(geonames_1000_path),
            },
        },
        "records": records,
    }


def main() -> None:
    args = parse_args()
    with tempfile.TemporaryDirectory(prefix="satori-world-cities-") as temp:
        temp_dir = Path(temp)
        basic_path = source_path(
            args.world_cities,
            DEFAULT_URLS["world_cities"],
            temp_dir,
            "world_cities_15000.csv",
        )
        admin_path = source_path(
            args.world_cities_admin,
            DEFAULT_URLS["world_cities_admin"],
            temp_dir,
            "world_cities_15000_admin.csv",
        )
        geonames_15000_path = source_path(
            args.geonames_15000_zip,
            DEFAULT_URLS["geonames_15000"],
            temp_dir,
            "cities15000.zip",
        )
        geonames_1000_path = source_path(
            args.geonames_1000_zip,
            DEFAULT_URLS["geonames_1000"],
            temp_dir,
            "cities1000.zip",
        )
        catalog = build_catalog(basic_path, admin_path, geonames_15000_path, geonames_1000_path)

    payload = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    metadata = catalog["metadata"]
    print(
        f"wrote {args.output}: {metadata['locationCount']} locations "
        f"({metadata['chinaLocationCount']} China), {len(payload)} bytes raw"
    )


if __name__ == "__main__":
    main()
