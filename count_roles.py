#!/usr/bin/env python3
"""
Count DReps and SPOs from public/data.json.

Counts are independent:
- If an entity has both drepId and spoId, it is counted once in each category.
"""

import json
import sys


DATA_PATH = "public/data.json"


def is_present(value) -> bool:
    """Treat None and empty strings as missing values."""
    return value is not None and str(value).strip() != ""


def main() -> None:
    try:
        with open(DATA_PATH, "r") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: Could not find {DATA_PATH}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as exc:
        print(f"ERROR: Invalid JSON in {DATA_PATH}: {exc}", file=sys.stderr)
        sys.exit(1)

    entities = data.get("entities", [])

    drep_count = sum(1 for e in entities if is_present(e.get("drepId")))
    spo_count = sum(1 for e in entities if is_present(e.get("spoId")))
    both_count = sum(
        1
        for e in entities
        if is_present(e.get("drepId")) and is_present(e.get("spoId"))
    )

    print(f"Total entities: {len(entities)}")
    print(f"DReps: {drep_count}")
    print(f"SPOs: {spo_count}")
    print(f"Both DRep and SPO: {both_count}")


if __name__ == "__main__":
    main()
