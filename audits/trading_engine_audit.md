# Trading Engine Audit — Initial Notes

Scope
- Review bot-engine order placement flow, strategy execution, connector calls, and failure handling.

Files to review
- `bot-engine/strategy_engine.py`
- `bot-engine/configured_algo.py`
- `bot-engine/exchange_connector.py`
- `bot-engine/close_all_engine.py`
- `bot-engine/algorithms/`

Initial checklist
- [ ] Confirm safe guards before placing live orders (`setup_futures_position`, leverage/margin checks).
- [ ] Ensure quantity/price rounding uses exchange constraints (`get_market_constraints`).
- [ ] Check error handling around order placement and stop-loss attachment.
- [ ] Look for any synchronous blocking calls in async paths.

Next actionable steps
1. Run a static scan for `place_order` and `place_order_with_leverage` callsites.
2. Confirm all callsites handle exceptions from `ExchangeConnector` safely.
3. Produce remediation notes and code patches where risky patterns are found.

