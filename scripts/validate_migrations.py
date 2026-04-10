#!/usr/bin/env python3
"""
Simple migration validation script for CI.

Checks:
- All `.sql` files in `drizzle/migrations` are present in `meta/_journal.json` (tags).
- The ordering of migration filenames matches the journal ordering.
- Reports missing/extra tags and missing snapshots.

Exit codes:
- 0: OK
- 1: Validation failed (mismatch between files and journal)
"""
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MIGRATIONS_DIR = os.path.join(REPO_ROOT, "drizzle", "migrations")
META_DIR = os.path.join(MIGRATIONS_DIR, "meta")
JOURNAL_PATH = os.path.join(META_DIR, "_journal.json")


def load_migration_files():
    files = [f for f in os.listdir(MIGRATIONS_DIR) if f.endswith('.sql')]
    files.sort()
    tags = [os.path.splitext(f)[0] for f in files]
    return tags


def load_journal_tags():
    if not os.path.exists(JOURNAL_PATH):
        print(f"ERROR: journal not found at {JOURNAL_PATH}")
        sys.exit(1)
    with open(JOURNAL_PATH, 'r', encoding='utf-8') as fh:
        j = json.load(fh)
    entries = j.get('entries', [])
    tags = [e.get('tag') for e in entries if e.get('tag')]
    return tags


def main():
    migration_tags = load_migration_files()
    journal_tags = load_journal_tags()

    missing_in_journal = [t for t in migration_tags if t not in journal_tags]
    extra_in_journal = [t for t in journal_tags if t not in migration_tags]
    order_mismatch = migration_tags != journal_tags[: len(migration_tags)]

    ok = True

    if missing_in_journal:
        print("ERROR: The following migration files are missing from meta/_journal.json:")
        for t in missing_in_journal:
            print("  - ", t)
        ok = False

    if extra_in_journal:
        print("WARNING: The following journal entries have no matching .sql file:")
        for t in extra_in_journal:
            print("  - ", t)
        # treat extra entries as a warning, not fatal

    if order_mismatch:
        print("ERROR: Migration filename order does not match journal order.")
        print("Migration files:", migration_tags)
        print("Journal tags   :", journal_tags[: len(migration_tags)])
        ok = False

    # Check snapshots (informational)
    missing_snapshots = []
    for t in migration_tags:
        snapshot_path = os.path.join(META_DIR, f"{t.replace('0000_', '0000_')}_snapshot.json")
        # Dated projects may not have snapshots for every migration; this is informational
        if not os.path.exists(snapshot_path):
            missing_snapshots.append(snapshot_path)

    if missing_snapshots:
        print("NOTE: Missing snapshots for some migrations (informational):")
        for p in missing_snapshots[:10]:
            print("  -", p)
        if len(missing_snapshots) > 10:
            print(f"  ... and {len(missing_snapshots) - 10} more")

    if not ok:
        print("\nMigration validation failed.")
        sys.exit(1)

    print("Migration validation passed.")
    sys.exit(0)


if __name__ == '__main__':
    main()
