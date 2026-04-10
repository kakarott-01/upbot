# Remediation SQL / Code Patches — Plan

Purpose
- Collect and track small, targeted code and SQL patches that remediate issues found during audits.

Structure
- Group patches by area (migrations, trading engine, risk, logging, infra).
- Include: description, affected files, minimal patch, testing notes, and CI checks.

Initial TODO
- [ ] Add migration fixes here if the migration validation script reports issues.
- [ ] Add quick code patches (e.g., missing `persist_state` calls) with tests.

