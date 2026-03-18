#!/usr/bin/env python3
"""
Generate a randomized schedule.json for drep-of-the-month.

Reads public/data.json, randomly assigns a drep-of-the-month and spo-of-the-month
for a default 3-month window starting February 2026.

Constraints:
  - An entity cannot be both drep and spo of the month in the same month.
  - William's drepId is excluded from drep-of-the-month selection.
  - Entities are reused as needed (there are fewer candidates than months).
  - Each drep/spo is used at most once before the pool resets (round-robin shuffle).
"""

import argparse
import json
import random
import sys
from datetime import datetime
from dateutil.relativedelta import relativedelta


EXCLUDED_DREP_ID = "drep1yfpgzfymq6tt9c684e7vzata8r5pl4w84fmrjqeztdqw0sgpzw3nt"

DATA_PATH = "public/data.json"
OUTPUT_PATH = "public/schedule.json"

# Default generation window: February 2026 through April 2026 (3 months)
MONTHS = [
    (2026, m) if m >= 2 else (2027, m)
    for m in [2, 3, 4]
]


def load_entities(path: str) -> list[dict]:
    with open(path, "r") as f:
        data = json.load(f)
    return data["entities"]


def build_pools(entities: list[dict]) -> tuple[list[dict], list[dict]]:
    """Return (drep_pool, spo_pool) — lists of entities eligible for each role."""
    drep_pool = []
    spo_pool = []
    for e in entities:
        if e.get("drepId") and e["drepId"] != EXCLUDED_DREP_ID:
            drep_pool.append(e)
        if e.get("spoId"):
            spo_pool.append(e)
    return drep_pool, spo_pool


class ShuffledBag:
    """Yields items in shuffled order, reshuffling when exhausted."""

    def __init__(self, items: list):
        if not items:
            raise ValueError("ShuffledBag requires at least one item")
        self._items = list(items)
        self._remaining: list = []

    def draw(self, exclude_names: set[str] | None = None) -> object:
        """Draw one item, optionally excluding certain entity names this round."""
        # Try from remaining first
        for _ in range(len(self._remaining)):
            candidate = self._remaining.pop(0)
            if exclude_names and candidate["name"] in exclude_names:
                self._remaining.append(candidate)
                continue
            return candidate

        # Reshuffle and try again
        self._remaining = list(self._items)
        random.shuffle(self._remaining)
        for _ in range(len(self._remaining)):
            candidate = self._remaining.pop(0)
            if exclude_names and candidate["name"] in exclude_names:
                self._remaining.append(candidate)
                continue
            return candidate

        # If every item is excluded (shouldn't happen), just return any
        random.shuffle(self._remaining)
        return self._remaining.pop(0)


def generate_months(
    entities: list[dict],
    months: list[tuple[int, int]],
    seed: str,
    prev_drep_name: str | None = None,
    prev_spo_name: str | None = None,
) -> list[dict]:
    """Generate schedule entries for the given (year, month) list using the provided seed.

    prev_drep_name / prev_spo_name can be provided so the first generated month
    avoids repeating the last entry of an existing schedule.
    """
    random.seed(seed)

    drep_pool, spo_pool = build_pools(entities)

    if not drep_pool:
        print("ERROR: No eligible dreps found in data.json", file=sys.stderr)
        sys.exit(1)
    if not spo_pool:
        print("ERROR: No eligible SPOs found in data.json", file=sys.stderr)
        sys.exit(1)

    print(f"Eligible dreps: {len(drep_pool)}  —  {[e['name'] for e in drep_pool]}")
    print(f"Eligible SPOs:  {len(spo_pool)}  —  {[e['name'] for e in spo_pool]}")
    print()

    drep_bag = ShuffledBag(drep_pool)
    spo_bag = ShuffledBag(spo_pool)

    schedule = []
    for year, month in months:
        # Exclude the previous month's drep so we don't get the same one back-to-back
        drep_exclude: set[str] = set()
        if prev_drep_name:
            drep_exclude.add(prev_drep_name)
        drep_entity = drep_bag.draw(exclude_names=drep_exclude or None)

        # Exclude the entity already chosen as drep this month AND the previous month's spo
        spo_exclude: set[str] = {drep_entity["name"]}
        if prev_spo_name:
            spo_exclude.add(prev_spo_name)
        spo_entity = spo_bag.draw(exclude_names=spo_exclude)

        timestamp = f"{year}-{month:02d}-01T00:00:00Z"
        schedule.append({
            "drepId": drep_entity["drepId"],
            "spoId": spo_entity["spoId"],
            "timestamp": timestamp,
        })

        print(f"  {timestamp}  drep: {drep_entity['name']:<40}  spo: {spo_entity['name']}")

        # Track for next iteration
        prev_drep_name = drep_entity["name"]
        prev_spo_name = spo_entity["name"]

    return schedule


def load_existing_schedule(path: str) -> list[dict]:
    """Load the existing schedule.json, returning an empty list if it doesn't exist."""
    try:
        with open(path, "r") as f:
            return json.load(f)["schedule"]
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        return []


def latest_entry(schedule: list[dict]) -> dict:
    """Return the entry with the latest (max) timestamp from a schedule."""
    return max(schedule, key=lambda x: x["timestamp"])


def entity_name_by_drep_id(entities: list[dict], drep_id: str) -> str | None:
    """Look up an entity name by its drepId."""
    for e in entities:
        if e.get("drepId") == drep_id:
            return e["name"]
    return None


def entity_name_by_spo_id(entities: list[dict], spo_id: str) -> str | None:
    """Look up an entity name by its spoId."""
    for e in entities:
        if e.get("spoId") == spo_id:
            return e["name"]
    return None


def main():
    parser = argparse.ArgumentParser(description="Generate schedule.json for drep-of-the-month")
    parser.add_argument("seed", nargs="?",
                        default="8d66b6944b4724d98e8e255c0a8d6b334dc698a553f19e085ae00b350f004454",
                        help="Seed string for deterministic RNG (default: block hash)")
    parser.add_argument("--continue", dest="continue_months", type=int, metavar="N",
                        help="Extend the existing schedule by N months instead of regenerating")
    args = parser.parse_args()

    # grab a recent block hash as the seed so nobody claims I'm cheating
    base_seed = args.seed
    entities = load_entities(DATA_PATH)

    if args.continue_months:
        # --- Continue mode: extend existing schedule ---
        existing = load_existing_schedule(OUTPUT_PATH)
        if not existing:
            print("ERROR: No existing schedule found to continue from.", file=sys.stderr)
            sys.exit(1)

        last = latest_entry(existing)
        latest_ts = last["timestamp"]
        latest_date = datetime.fromisoformat(latest_ts.replace("Z", "+00:00"))

        # Resolve the last entry's drep/spo names so we can avoid back-to-back repeats
        prev_drep = entity_name_by_drep_id(entities, last.get("drepId", ""))
        prev_spo = entity_name_by_spo_id(entities, last.get("spoId", ""))

        # Build the list of new months to add
        new_months = []
        for i in range(1, args.continue_months + 1):
            dt = latest_date + relativedelta(months=i)
            new_months.append((dt.year, dt.month))

        # Seed includes the latest existing date so we get a fresh sequence
        seed = f"{base_seed}::{latest_ts}"
        print(f"Continuing from {latest_ts}")
        print(f"Using seed: {seed}\n")

        new_entries = generate_months(entities, new_months, seed=seed,
                                      prev_drep_name=prev_drep, prev_spo_name=prev_spo)
        schedule = existing + new_entries
    else:
        # --- Fresh generation mode ---
        seed = base_seed
        print(f"Using seed: {seed}\n")
        schedule = generate_months(entities, MONTHS, seed=seed)

    # Sort descending by timestamp (newest first) to match existing format
    schedule.sort(key=lambda x: x["timestamp"], reverse=True)

    output = {"schedule": schedule}
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=4)
        f.write("\n")

    print(f"\nWrote {len(schedule)} months to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
