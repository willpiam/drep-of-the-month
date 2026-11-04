#!/usr/bin/env python3
"""
Count DReps and SPOs from public/data.json.

Total only includes entities with a drepId, an spoId, or both.
Role counts are independent: an entity with both ids is counted once in each.
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

    has_drep = [is_present(e.get("drepId")) for e in entities]
    has_spo = [is_present(e.get("spoId")) for e in entities]

    drep_count = sum(has_drep)
    spo_count = sum(has_spo)
    both_count = sum(d and s for d, s in zip(has_drep, has_spo))
    total_count = sum(d or s for d, s in zip(has_drep, has_spo))

    print(f"Total entities: {total_count}")
    print(f"DReps: {drep_count}")
    print(f"SPOs: {spo_count}")
    print(f"Both DRep and SPO: {both_count}")


if __name__ == "__main__":
    main()
