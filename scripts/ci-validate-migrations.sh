#!/usr/bin/env bash
set -euo pipefail

PYTHON=${PYTHON:-python3}
$PYTHON scripts/validate_migrations.py
