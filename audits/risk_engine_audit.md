# Risk Engine Audit — Initial Notes

Scope
- Verify `RiskManager` and `GlobalRiskManager` are correctly persisting and enforcing limits.

Files to review
- `bot-engine/risk_manager.py`
- Database persistence: `db.py` methods `get_risk_state`, `update_risk_state`, `sync_open_trade_count`
- Integration points: where `risk_mgr` is used in `scheduler.py` and algos

Initial checklist
- [ ] Confirm `persist_state` is called after trade open/close events.
- [ ] Ensure cooldown and daily loss calculations are robust across restarts.
- [ ] Check concurrency safety around `open_trade_count` and DB sync.

Next steps
- Static search for `persist_state` callsites and add missing calls.
- Add unit tests for `can_open_position` and `can_trade` edge cases.

