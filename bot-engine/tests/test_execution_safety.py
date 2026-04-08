import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path


def _install_test_stubs() -> None:
    if "ccxt.async_support" not in sys.modules:
        ccxt_pkg = types.ModuleType("ccxt")
        ccxt_async = types.ModuleType("ccxt.async_support")

        class ExchangeError(Exception):
            pass

        ccxt_async.ExchangeError = ExchangeError
        for exchange_name in ("bingx", "coindcx", "coinswitch", "delta", "binance", "kraken", "ibkr"):
            setattr(ccxt_async, exchange_name, object)
        ccxt_pkg.async_support = ccxt_async
        sys.modules["ccxt"] = ccxt_pkg
        sys.modules["ccxt.async_support"] = ccxt_async

    if "pandas" not in sys.modules:
        pandas_stub = types.ModuleType("pandas")
        pandas_stub.DataFrame = object
        pandas_stub.to_datetime = lambda *args, **kwargs: None
        sys.modules["pandas"] = pandas_stub


_install_test_stubs()
BOT_ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(BOT_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_ENGINE_DIR))


def _load_module(module_name: str, file_name: str):
    spec = importlib.util.spec_from_file_location(module_name, BOT_ENGINE_DIR / file_name)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


exchange_connector_module = _load_module("exchange_connector", "exchange_connector.py")
risk_manager_module = _load_module("risk_manager", "risk_manager.py")
base_algo_module = _load_module("test_base_algo_module", "algorithms/base_algo.py")

BaseAlgo = base_algo_module.BaseAlgo
ExecutionVerificationError = base_algo_module.ExecutionVerificationError
RiskManager = risk_manager_module.RiskManager
FatalExecutionError = exchange_connector_module.FatalExecutionError


class DummyConnector:
    def __init__(self):
        self.exchange_name = "dummy"
        self.market_type = "crypto"
        self.order = {"id": "order-1"}
        self.fetch_order_response = {"status": "closed", "filled": 1.0, "average": 100.0}
        self.position = None
        self.open_orders = []
        self.attach_stop_side_effect = None
        self.verify_stop_result = True
        self.attach_calls = []
        self.emergency_close_calls = []
        self.cancel_calls = []
        self.market_constraints = {"quantity": 1.0, "min_qty": 0.001, "min_notional": 5.0, "price": 100.0}
        self.liquidation_price = 50.0

    def estimate_liquidation_price(self, entry_price: float, side: str, leverage: int):
        return self.liquidation_price

    async def get_market_constraints(self, symbol: str, quantity=None, price=None):
        result = dict(self.market_constraints)
        if quantity is not None:
            result["quantity"] = self.market_constraints.get("quantity", quantity)
        if price is not None:
            result["price"] = self.market_constraints.get("price", price)
        return result

    async def round_price_to_market(self, symbol: str, price: float) -> float:
        return round(price, 8)

    async def place_order_with_leverage(self, symbol: str, side: str, quantity: float, leverage: int = 1, stop_loss: float | None = None, **kwargs):
        return dict(self.order)

    async def fetch_order(self, order_id: str, symbol: str):
        if isinstance(self.fetch_order_response, Exception):
            raise self.fetch_order_response
        return dict(self.fetch_order_response)

    async def fetch_position_for_symbol(self, symbol: str):
        return None if self.position is None else dict(self.position)

    async def attach_verified_stop_loss(self, symbol: str, side: str, quantity: float, stop_loss: float, retries: int = 3):
        self.attach_calls.append((symbol, side, quantity, stop_loss))
        if self.attach_stop_side_effect is not None:
            raise self.attach_stop_side_effect
        return {"id": "sl-1"}

    async def verify_stop_loss_order(self, symbol: str, side: str, quantity: float, stop_loss: float, order_id=None):
        return self.verify_stop_result

    async def emergency_close_position(self, symbol: str, side: str, quantity: float):
        self.emergency_close_calls.append((symbol, side, quantity))
        return {"id": f"close-{len(self.emergency_close_calls)}"}

    async def fetch_open_orders_checked(self, symbol: str | None = None):
        return [dict(order) for order in self.open_orders]

    async def cancel_order(self, order_id: str, symbol: str):
        self.cancel_calls.append((order_id, symbol))
        return {"id": order_id}

    def _extract_stop_price(self, order):
        return order.get("stopPrice") or order.get("triggerPrice")


class DummyDB:
    def __init__(self):
        self.saved_live_trade = None
        self.failed_live_orders = []
        self.kill_switch_events = []
        self.bot_errors = []
        self.open_trades_for_symbol = []
        self.sync_open_trade_count_value = 0
        self.risk_updates = []
        self.saved_signals = []

    async def save_live_trade(
        self,
        user_id,
        symbol,
        side,
        quantity,
        price,
        stop_loss,
        take_profit,
        order_id,
        algo_name,
        market_type,
        **kwargs,
    ):
        self.saved_live_trade = {
            "user_id": user_id,
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "price": price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "order_id": order_id,
            "algo_name": algo_name,
            "market_type": market_type,
            **kwargs,
        }
        return "trade-1"

    async def save_failed_live_order(self, **kwargs):
        self.failed_live_orders.append(kwargs)

    async def spool_live_trade(self, payload):
        raise AssertionError(f"spool_live_trade should not be called in this test: {payload}")

    async def touch_strategy_trade(self, user_id: str, market_type: str, strategy_key):
        return None

    async def update_risk_state(self, user_id: str, market_type: str, daily_loss: float, open_trade_count: int, last_loss_time=None):
        self.risk_updates.append((daily_loss, open_trade_count, last_loss_time))

    async def set_bot_error_state(self, user_id: str, error_msg: str):
        self.bot_errors.append(error_msg)

    async def set_kill_switch_state(self, user_id: str, is_active: bool, close_positions: bool = False, reason: str | None = None):
        self.kill_switch_events.append(
            {
                "is_active": is_active,
                "close_positions": close_positions,
                "reason": reason,
            }
        )

    async def get_open_trades_for_symbol(self, user_id: str, market_type: str, symbol: str):
        return [dict(trade) for trade in self.open_trades_for_symbol]

    async def sync_open_trade_count(self, user_id: str, market_type: str):
        return self.sync_open_trade_count_value

    async def cancel_orphan_trade(self, trade_id: str):
        return True


class DummyAlgo(BaseAlgo):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._open_positions = {}
        self._staged_open = {}

    def _confirm_staged_open(self, symbol: str):
        pending = self._staged_open.pop(symbol, None)
        if pending:
            self._open_positions[symbol] = pending

    def _discard_staged_open(self, symbol: str):
        self._staged_open.pop(symbol, None)

    @property
    def market_type(self) -> str:
        return "crypto"

    def config_filename(self) -> str:
        return "__missing__.json"

    def default_config(self):
        return {
            "risk_pct_per_trade": 1.0,
            "fee_rate": 0.001,
            "quote_currency": "USDT",
            "symbols": ["BTC/USDT"],
        }

    def get_symbols(self) -> list:
        return ["BTC/USDT"]

    async def generate_signal(self, symbol: str):
        return None


class ExecutionSafetyTests(unittest.IsolatedAsyncioTestCase):
    def make_algo(self, connector: DummyConnector | None = None, db: DummyDB | None = None, paper_mode: bool = False):
        connector = connector or DummyConnector()
        db = db or DummyDB()
        risk = RiskManager({"daily_loss_limit_pct": 3.0, "max_open_trades": 3})
        algo = DummyAlgo(
            connector=connector,
            risk_mgr=risk,
            db=db,
            user_id="user-1",
            paper_mode=paper_mode,
            session_ref="session-1",
            position_scope_key="crypto",
        )
        return algo, connector, db

    async def test_stop_loss_failure_triggers_emergency_close(self):
        algo, connector, db = self.make_algo()
        algo._staged_open["BTC/USDT"] = {"leverage": 5, "confidence": 70.0}
        connector.order = {"id": "order-1"}
        connector.fetch_order_response = {"status": "closed", "filled": 1.0, "average": 100.0}
        connector.attach_stop_side_effect = RuntimeError("sl attach rejected")

        with self.assertRaises(FatalExecutionError):
            await algo._execute_live_trade(
                symbol="BTC/USDT",
                signal="BUY",
                quantity=1.0,
                price=100.0,
                trade_plan={"risk_amount": 10.0, "margin_used": 10.0, "stop_loss": 90.0, "take_profit": 105.0},
            )

        self.assertEqual(len(connector.emergency_close_calls), 1)
        self.assertIsNone(db.saved_live_trade)
        self.assertEqual(db.kill_switch_events, [])

    async def test_partial_fill_uses_filled_quantity_for_stop_and_tracking(self):
        algo, connector, db = self.make_algo()
        algo._staged_open["BTC/USDT"] = {"leverage": 5, "confidence": 75.0}
        connector.order = {"id": "order-1", "stopLossOrderId": "sl-old"}
        connector.fetch_order_response = {"status": "closed", "filled": 0.5, "average": 100.0}

        opened = await algo._execute_live_trade(
            symbol="BTC/USDT",
            signal="BUY",
            quantity=1.0,
            price=100.0,
            trade_plan={"risk_amount": 10.0, "margin_used": 10.0, "stop_loss": 90.0, "take_profit": 105.0},
        )

        self.assertTrue(opened)
        self.assertIsNotNone(db.saved_live_trade)
        self.assertAlmostEqual(db.saved_live_trade["actual_quantity"], 0.5)
        self.assertAlmostEqual(connector.attach_calls[-1][2], 0.5)
        self.assertAlmostEqual(algo._open_positions["BTC/USDT"]["quantity"], 0.5)

    async def test_liquidation_buffer_rejects_unsafe_trade(self):
        algo, connector, _ = self.make_algo()
        connector.market_constraints["quantity"] = 1.0
        connector.market_constraints["min_notional"] = 1.0
        connector.liquidation_price = 95.0

        with self.assertRaises(ValueError):
            await algo._build_trade_plan(
                symbol="BTC/USDT",
                side="BUY",
                balance=1000.0,
                entry_price=100.0,
                leverage=10,
            )

    def test_level_plan_applies_fee_risk_safety_buffer(self):
        algo, connector, _ = self.make_algo()
        connector.liquidation_price = 70.0

        level_plan = algo._build_level_plan(
            entry_price=100.0,
            quantity=1.0,
            leverage=5,
            side="BUY",
            risk_amount=10.0,
            fee_rate=0.0,
        )

        self.assertAlmostEqual(level_plan["estimated_total_loss"], 9.9901, places=4)
        self.assertGreater(level_plan["stop_loss"], 90.0)

    async def test_fee_precision_overflow_within_epsilon_is_not_rejected(self):
        algo, connector, _ = self.make_algo()
        connector.market_constraints["quantity"] = 0.5
        connector.market_constraints["min_notional"] = 1.0
        connector.liquidation_price = 70.0
        algo._build_level_plan = lambda *args, **kwargs: {
            "actual_notional": 50.0,
            "sl_distance": 0.1,
            "tp_distance": 0.05,
            "stop_loss": 90.0,
            "take_profit": 105.0,
            "liquidation_price": 70.0,
            "estimated_total_loss": 10.00002037,
        }
        algo._estimate_total_loss = lambda *args, **kwargs: 10.00002037

        plan = await algo._build_trade_plan("BTC/USDT", "BUY", 1000.0, 100.0, 5)

        self.assertAlmostEqual(plan["quantity"], 0.5)
        self.assertAlmostEqual(plan["estimated_total_loss"], 10.00002037)

    async def test_fee_risk_overflow_scales_quantity_and_logs_adjustment(self):
        algo, connector, _ = self.make_algo()
        connector.market_constraints["quantity"] = 0.5
        connector.market_constraints["min_notional"] = 1.0
        connector.liquidation_price = 70.0

        async def scaled_constraints(symbol: str, quantity=None, price=None):
            result = dict(connector.market_constraints)
            if quantity is not None:
                result["quantity"] = round(quantity, 8)
            if price is not None:
                result["price"] = round(price, 8)
            return result

        connector.get_market_constraints = scaled_constraints
        algo._build_level_plan = lambda entry_price, quantity, leverage, side, risk_amount, fee_rate=None: {
            "actual_notional": entry_price * quantity,
            "sl_distance": 0.1,
            "tp_distance": 0.05,
            "stop_loss": 90.0,
            "take_profit": 105.0,
            "liquidation_price": 70.0,
            "estimated_total_loss": quantity * 20.2,
        }
        algo._estimate_total_loss = lambda entry_price, stop_price, quantity, side, fee_rate: quantity * 20.2

        with self.assertLogs(base_algo_module.logger.name, level="WARNING") as logs:
            plan = await algo._build_trade_plan("BTC/USDT", "BUY", 1000.0, 100.0, 5)

        self.assertLess(plan["quantity"], 0.5)
        self.assertAlmostEqual(plan["estimated_total_loss"], 10.0, places=6)
        self.assertTrue(any("Adjusted size for BTC/USDT" in entry for entry in logs.output))

    def test_daily_loss_limit_blocks_new_trades(self):
        risk = RiskManager({"daily_loss_limit_pct": 3.0, "max_open_trades": 3})
        risk.daily_loss = -31.0
        ok, reason = risk.can_trade(1000.0)
        self.assertFalse(ok)
        self.assertIn("Daily loss limit", reason)

    async def test_symbol_lock_blocks_concurrent_duplicate_processing(self):
        algo, _, _ = self.make_algo()
        started = asyncio.Event()

        async def hold_lock():
            async with algo._symbol_execution_guard("BTC/USDT"):
                started.set()
                await asyncio.sleep(3)

        first = asyncio.create_task(hold_lock())
        await started.wait()
        with self.assertRaises(ExecutionVerificationError):
            async with algo._symbol_execution_guard("BTC/USDT"):
                self.fail("second lock acquisition should not succeed")
        await first

    async def test_order_status_api_failure_blocks_trading(self):
        algo, connector, _ = self.make_algo()
        connector.fetch_order_response = RuntimeError("status unavailable")
        connector.position = None

        with self.assertRaises(ExecutionVerificationError):
            await algo._fetch_fill_details("order-1", "BTC/USDT", 1.0, 100.0)

        self.assertIn("BTC/USDT", algo._blocked_symbols)

    async def test_restart_rebuilds_trade_from_exchange_state(self):
        algo, connector, db = self.make_algo()
        connector.position = {
            "symbol": "BTC/USDT",
            "side": "buy",
            "quantity": 0.5,
            "entry_price": 100.0,
            "liquidation_price": 80.0,
            "leverage": 5,
        }
        connector.open_orders = [{"id": "sl-1", "side": "sell", "stopPrice": 90.0, "amount": 0.5}]

        reconciled = await algo._reconcile_symbol_state("BTC/USDT")

        self.assertTrue(reconciled)
        self.assertIsNotNone(db.saved_live_trade)
        self.assertAlmostEqual(db.saved_live_trade["actual_quantity"], 0.5)
        self.assertIn("BTC/USDT", algo._open_positions)

    async def test_paper_and_live_share_identical_trade_plan_math(self):
        live_algo, connector, _ = self.make_algo(paper_mode=False)
        paper_algo, _, _ = self.make_algo(connector=connector, paper_mode=True)
        connector.market_constraints["quantity"] = 1.0
        connector.market_constraints["min_notional"] = 1.0
        connector.liquidation_price = 70.0

        live_plan = await live_algo._build_trade_plan("BTC/USDT", "BUY", 1000.0, 100.0, 5)
        paper_plan = await paper_algo._build_trade_plan("BTC/USDT", "BUY", 1000.0, 100.0, 5)

        for key in ("risk_amount", "margin_used", "quantity", "stop_loss", "take_profit", "actual_notional"):
            self.assertAlmostEqual(live_plan[key], paper_plan[key])


if __name__ == "__main__":
    unittest.main()
