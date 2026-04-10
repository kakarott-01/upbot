# Strategy System Audit — Initial Notes

Scope
- Review strategy execution, signal generation, voting/combination, and backtest parity.

Files to review
- `bot-engine/strategy_engine.py`
- `bot-engine/configured_algo.py`
- `bot-engine/algorithms/` (strategy implementations)

Initial checklist
- [ ] Verify `BlackBoxStrategyExecutor` decision logic and vote combining.
- [ ] Confirm backtest engine (`run_backtest`) produces comparable results to live signals.
- [ ] Check default timeframe and fallback behavior when data is sparse.

Next steps
- Run backtests on a small sample and compare decisions vs live cycle behavior.

