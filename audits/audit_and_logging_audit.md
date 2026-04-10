# Audit & Logging Audit — Initial Notes

Scope
- Ensure audit trails and logging capture sufficient context for post-mortems and compliance.

Files to review
- `bot-engine/main.py` (startup/shutdown events)
- `bot-engine/scheduler.py` (heartbeats, persist_state)
- `bot-engine/db.py` (audit tables, journaling)
- Any logging middleware or toast/store equivalents in the Next.js app for UI audit

Initial checklist
- [ ] Confirm each trade lifecycle event writes an auditable DB record (open/close/modify).
- [ ] Ensure exceptions that lead to state changes include context (user_id, market, symbol).
- [ ] Verify log levels and sensitive data redaction for PII/API keys.

Next steps
- Inventory DB audit tables and identify missing event types.
- Add structured logging where helpful (JSON fields) for downstream processing.

