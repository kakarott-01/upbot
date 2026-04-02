"""
bot-engine/algorithms/base_algo.py  — v4
==========================================
FIX ORPHAN: _execute_live_trade() now handles the critical scenario where a
            live order is placed on the exchange but the DB save returns None
            (duplicate blocked). Previously if the cancel attempt failed,
            the error was only logged and the trade was silently lost.

            Now: save_failed_live_order() is called so the trade appears in
            the failed_live_orders table visible in the dashboard, and the
            risk manager's open_trade_count is adjusted to prevent blocking
            future trades indefinitely.

All other fixes (FIX 5, FIX C, FIX K, PERF P) from v3 unchanged.
"""

import json
import logging
import os
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, List, Tuple
from datetime import datetime, timedelta

from exchange_connector import ExchangeConnector
from risk_manager import RiskManager

logger = logging.getLogger(__name__)

_config_file_cache: Dict[str, Tuple[float, Dict]] = {}


def _load_config_cached(config_path: str) -> Optional[Dict]:
    try:
        mtime  = os.path.getmtime(config_path)
        cached = _config_file_cache.get(config_path)
        if cached and cached[0] == mtime:
            return cached[1]
        with open(config_path, "r") as f:
            data = json.load(f)
        data.pop("paper_mode", None)
        _config_file_cache[config_path] = (mtime, data)
        logger.debug(f"📄 Config reloaded: {config_path}")
        return data
    except Exception as e:
        logger.error(f"❌ Config load error {config_path}: {e}")
        return None


RECONCILE_INTERVAL_SEC = 10 * 60


class BaseAlgo(ABC):
    def __init__(
        self,
        connector: ExchangeConnector,
        risk_mgr: RiskManager,
        db,
        user_id: str,
        paper_mode: bool = True,
        session_ref: str = "",
    ):
        self.connector    = connector
        self.risk         = risk_mgr
        self.db           = db
        self.user_id      = user_id
        self._paper_mode  = paper_mode
        self._session_ref = session_ref

        self._reconciled  = False
        self._risk_loaded = False

        self.config = self._load_config()
        self.name   = self.config.get("algo_name", self.__class__.__name__)

        logger.info(
            f"✅ [{self.name}] Init user={user_id[:8]}… "
            f"mode={'PAPER' if paper_mode else '🔴 LIVE'} ref={session_ref}"
        )

    def _load_config(self) -> Dict:
        base_dir    = os.path.dirname(__file__)
        config_path = os.path.join(base_dir, "configs", self.config_filename())
        if not os.path.exists(config_path):
            logger.warning(f"⚠️  Config not found: {config_path}, using defaults")
            return self.default_config()
        data = _load_config_cached(config_path)
        return data if data is not None else self.default_config()

    @abstractmethod
    def config_filename(self) -> str: ...
    def default_config(self) -> Dict: return {}
    @abstractmethod
    def get_symbols(self) -> list: ...
    @abstractmethod
    async def generate_signal(self, symbol: str) -> Optional[str]: ...
    @property
    @abstractmethod
    def market_type(self) -> str: ...

    async def _load_risk_state(self):
        if self._risk_loaded:
            return
        self._risk_loaded = True
        await self.risk.load_state(self.db, self.user_id, self.market_type)

    async def _get_bot_stop_mode(self) -> Optional[str]:
        try:
            return await self.db.get_bot_stop_mode(self.user_id)
        except Exception as e:
            logger.warning(f"[{self.name}] ⚠️  Could not read stop mode: {e}")
            return None

    async def _reconcile_positions(self):
        if self._paper_mode:
            self._reconciled = True
            return
        logger.info(f"[{self.name}] 🔍 Starting startup reconciliation…")
        try:
            db_open: List[Dict] = await self.db.get_all_open_trades(self.user_id, self.market_type)
            if not db_open:
                self._reconciled = True
                return
            owned = [
                t for t in db_open
                if t.get("bot_session_ref") == self._session_ref
                   or t.get("bot_session_ref") is None
            ] if self._session_ref else db_open
            if not owned:
                self._reconciled = True
                return
            try:
                exchange_orders  = await self.connector.fetch_open_orders()
                exchange_symbols = {o.get("symbol", "") for o in exchange_orders}
            except Exception as e:
                logger.warning(f"[{self.name}] ⚠️  Exchange order fetch failed during reconcile: {e}. Skipping.")
                self._reconciled = True
                return
            orphaned = 0
            for trade in owned:
                symbol = trade["symbol"]
                if symbol not in exchange_symbols:
                    logger.warning(f"[{self.name}] 🔍 Orphan at startup: {symbol} id={trade['id']}")
                    await self.db.cancel_orphan_trade(trade["id"])
                    if hasattr(self, "_open_positions"):
                        self._open_positions.pop(symbol, None)
                    orphaned += 1
            if orphaned:
                logger.info(f"[{self.name}] Startup reconciled {orphaned} orphan trade(s)")
        except Exception as e:
            logger.error(f"[{self.name}] ❌ Startup reconciliation error: {e}", exc_info=True)
        finally:
            self._reconciled = True

    async def _runtime_reconcile(self):
        if self._paper_mode:
            return
        try:
            last_run = await self.db.get_reconciliation_last_run(self.user_id, self.market_type)
            now      = datetime.utcnow()
            if last_run is not None and (now - last_run).total_seconds() < RECONCILE_INTERVAL_SEC:
                return
            logger.info(f"[{self.name}] 🔄 Runtime reconciliation starting…")
            db_open_map = await self.db.get_open_symbols_for_market(self.user_id, self.market_type)
            if not db_open_map:
                await self.db.update_reconciliation_log(self.user_id, self.market_type, 0)
                return
            try:
                exchange_orders  = await self.connector.fetch_open_orders()
                exchange_symbols = {o.get("symbol", "") for o in exchange_orders}
            except Exception as e:
                logger.warning(f"[{self.name}] ⚠️  Exchange fetch_open_orders failed: {e}. Skipping.")
                return
            fixed = 0
            for symbol, trade_id in db_open_map.items():
                if symbol not in exchange_symbols:
                    logger.warning(f"[{self.name}] 🔍 Runtime orphan: {symbol} id={trade_id}")
                    was_fixed = await self.db.cancel_orphan_trade(trade_id)
                    if was_fixed:
                        if hasattr(self, "_open_positions"):
                            self._open_positions.pop(symbol, None)
                        self.risk.open_trade_count = max(0, self.risk.open_trade_count - 1)
                        fixed += 1
            if fixed:
                logger.info(f"[{self.name}] Runtime reconciled {fixed} orphan trade(s)")
                await self.risk.persist_state(self.db, self.user_id, self.market_type)
            await self.db.update_reconciliation_log(self.user_id, self.market_type, fixed)
        except Exception as e:
            logger.error(f"[{self.name}] ❌ Runtime reconciliation error: {e}", exc_info=True)

    async def run_cycle(self):
        try:
            await self._run_cycle_inner()
        except Exception as e:
            logger.error(f"[{self.name}] ❌ run_cycle crashed: {e}", exc_info=True)
            try:
                await self.db.update_bot_status(self.user_id, "error", [], error=str(e))
            except Exception:
                pass

    async def _run_cycle_inner(self):
        if not self._reconciled:
            await self._reconcile_positions()
        if not self._risk_loaded:
            await self._load_risk_state()

        self.config = self._load_config()
        if not self.config.get("enabled", True):
            logger.info(f"[{self.name}] 🚫 Disabled by config")
            return

        await self._runtime_reconcile()

        stop_mode      = await self._get_bot_stop_mode()
        is_draining    = stop_mode == "graceful"
        is_closing_all = stop_mode == "close_all"

        if is_closing_all:
            logger.info(f"[{self.name}] ⏸  close_all in progress — skipping cycle")
            return

        logger.info(
            f"[{self.name}] 🔄 Cycle "
            f"[{'PAPER' if self._paper_mode else '🔴 LIVE'}]"
            f"{' [DRAINING]' if is_draining else ''}"
        )

        if self._paper_mode:
            balance = 10_000.0
        else:
            balance = await self.connector.get_balance(self.config.get("quote_currency", "USDT"))

        if balance <= 0:
            logger.warning(f"[{self.name}] ⚠️  Zero balance — skipping")
            return

        for symbol in self.get_symbols():
            await self._process_symbol(symbol, balance, is_draining=is_draining)

    async def _process_symbol(self, symbol: str, balance: float, is_draining: bool = False):
        try:
            signal = await self.generate_signal(symbol)
            if not signal:
                return

            signal = signal.upper()
            is_exit, open_trade_id, open_entry_price, open_side = await self._find_open_trade(symbol)

            if is_exit and open_trade_id:
                await self._close_trade(symbol, signal, open_trade_id, open_entry_price, open_side, balance)
                return

            if is_draining:
                logger.info(f"[{self.name}] 🚿 {symbol}: blocking new entry (drain mode)")
                return

            stop_mode_now = await self._get_bot_stop_mode()
            if stop_mode_now is not None:
                logger.info(f"[{self.name}] ⛔ {symbol}: stop mode activated mid-cycle — blocking entry")
                return

            can_trade, reason = self.risk.can_trade(balance)
            if not can_trade:
                logger.info(f"[{self.name}] ⛔ {symbol}: {reason}")
                return

            await self.db.save_signal(self.user_id, self.name, self.market_type, symbol, signal)

            ticker = await self.connector.fetch_ticker(symbol)
            price  = ticker.get("last")
            if not price:
                logger.warning(f"[{self.name}] ❌ No price for {symbol}")
                return

            quantity = self.risk.calculate_position_size(balance, price)
            if quantity <= 0:
                logger.warning(f"[{self.name}] ❌ Invalid qty for {symbol}")
                return

            if self._paper_mode:
                trade_id = await self.db.save_paper_trade(
                    self.user_id, symbol, signal, quantity,
                    price, self.name, self.market_type,
                    session_ref=self._session_ref,
                )
                if trade_id:
                    if hasattr(self, "_confirm_staged_open"):
                        self._confirm_staged_open(symbol)
                    self.risk.record_trade_opened()
                    await self.risk.persist_state(self.db, self.user_id, self.market_type)
                    logger.info(f"[{self.name}] 🧪 PAPER OPEN {signal} {quantity:.6f} {symbol} @ {price}")
                else:
                    if hasattr(self, "_discard_staged_open"):
                        self._discard_staged_open(symbol)
            else:
                await self._execute_live_trade(symbol, signal, quantity, price)

        except Exception as e:
            logger.error(f"[{self.name}] ❌ Symbol {symbol} error: {e}", exc_info=True)

    async def _find_open_trade(self, symbol: str) -> Tuple:
        try:
            row = await self.db.get_open_trade(self.user_id, symbol, self.market_type)
            if row:
                return True, row["id"], float(row["entry_price"]), row["side"]
        except Exception as e:
            logger.error(f"❌ find_open_trade error: {e}")
        return False, None, None, None

    async def _close_trade(
        self, symbol: str, exit_signal: str, trade_id: str,
        entry_price: float, original_side: str, balance: float,
    ):
        try:
            ticker     = await self.connector.fetch_ticker(symbol)
            exit_price = ticker.get("last")
            if not exit_price:
                logger.warning(f"[{self.name}] ❌ No price to close {symbol}")
                return

            open_row = await self.db.get_open_trade(self.user_id, symbol, self.market_type)
            if not open_row:
                if hasattr(self, "_open_positions"):
                    self._open_positions.pop(symbol, None)
                logger.info(f"[{self.name}] ℹ️  {symbol} already closed in DB, skipping close")
                return

            quantity = float(open_row["quantity"])
            if original_side.lower() == "sell":
                pnl = (entry_price - exit_price) * quantity
            else:
                pnl = (exit_price - entry_price) * quantity
            pnl_pct = (pnl / (entry_price * quantity)) * 100 if entry_price > 0 else 0

            if self._paper_mode:
                closed = await self.db.close_paper_trade(trade_id, exit_price, pnl, pnl_pct)
                if not closed:
                    if hasattr(self, "_open_positions"):
                        self._open_positions.pop(symbol, None)
                    return
                logger.info(
                    f"[{self.name}] 🧪 PAPER CLOSE {symbol} entry={entry_price} exit={exit_price} PnL={pnl:+.4f}"
                )
            else:
                order  = await self.connector.place_order(symbol, exit_signal, quantity)
                closed = await self.db.close_live_trade(trade_id, exit_price, pnl, pnl_pct, order.get("id", ""))
                if not closed:
                    if hasattr(self, "_open_positions"):
                        self._open_positions.pop(symbol, None)
                    return

            self.risk.record_trade_closed(pnl)
            await self.risk.persist_state(self.db, self.user_id, self.market_type)

        except Exception as e:
            logger.error(f"[{self.name}] ❌ Close trade failed {symbol}: {e}", exc_info=True)

    async def _execute_live_trade(self, symbol: str, signal: str, quantity: float, price: float):
        """
        FIX ORPHAN: Handles the critical case where a live order is placed on the
        exchange but the DB save returns None (duplicate blocked by constraint).

        Previously: if cancel also failed, the error was only logged — real money
        was committed to a position the system had no record of.

        Now: save_failed_live_order() always records the failure for manual review,
        and the risk manager open_trade_count is NOT incremented (since we have no
        DB record), preventing the risk system from blocking future trades forever.
        """
        sl    = self.risk.calculate_stop_loss(price, signal)
        tp    = self.risk.calculate_take_profit(price, signal)
        order = None
        try:
            order    = await self.connector.place_order(symbol, signal, quantity)
            order_id = order.get("id", "")

            trade_id = await self.db.save_live_trade(
                self.user_id, symbol, signal, quantity,
                price, sl, tp, order_id,
                self.name, self.market_type,
                session_ref=self._session_ref,
            )

            if trade_id:
                # Happy path: order placed AND recorded in DB
                if hasattr(self, "_confirm_staged_open"):
                    self._confirm_staged_open(symbol)
                self.risk.record_trade_opened()
                await self.risk.persist_state(self.db, self.user_id, self.market_type)
                logger.info(f"[{self.name}] ✅ LIVE {signal} {quantity} {symbol} order={order_id}")
            else:
                # FIX ORPHAN: Order placed but DB rejected duplicate.
                # Attempt to cancel the exchange order.
                if hasattr(self, "_discard_staged_open"):
                    self._discard_staged_open(symbol)

                cancel_attempted  = False
                cancel_succeeded  = False
                cancel_error: Optional[str] = None

                if order_id:
                    cancel_attempted = True
                    logger.error(
                        f"[{self.name}] ❌ CRITICAL: Live order placed ({order_id}) but "
                        f"DB rejected duplicate for {symbol}. Attempting to cancel order…"
                    )
                    try:
                        await self.connector.cancel_order(order_id, symbol)
                        cancel_succeeded = True
                        logger.info(f"[{self.name}] ✅ Order {order_id} cancelled successfully")
                    except Exception as cancel_err:
                        cancel_error = str(cancel_err)
                        logger.error(
                            f"[{self.name}] ❌ Cancel failed for order {order_id}: {cancel_err}. "
                            "Recording for manual review."
                        )

                # Always record the failure regardless of cancel outcome
                fail_reason = (
                    "duplicate_blocked_cancel_ok" if cancel_succeeded
                    else "duplicate_blocked_cancel_failed" if cancel_attempted
                    else "duplicate_blocked_no_order_id"
                )
                await self.db.save_failed_live_order(
                    user_id=self.user_id,
                    exchange_name=self.connector.exchange_name,
                    market_type=self.market_type,
                    symbol=symbol,
                    side=signal.lower(),
                    quantity=quantity,
                    entry_price=price,
                    exchange_order_id=order_id if order_id else None,
                    fail_reason=fail_reason,
                    cancel_attempted=cancel_attempted,
                    cancel_succeeded=cancel_succeeded,
                    cancel_error=cancel_error,
                )

                # If cancel failed, there is a real open position on the exchange
                # with no DB record. This MUST be manually reviewed.
                if not cancel_succeeded and cancel_attempted:
                    logger.critical(
                        f"[{self.name}] 💀 UNTRACKED LIVE POSITION: {signal} {quantity} {symbol} "
                        f"order={order_id}. Cancel failed. MANUAL EXCHANGE ACTION REQUIRED. "
                        "Position recorded in failed_live_orders table."
                    )

        except Exception as e:
            logger.error(f"[{self.name}] ❌ Live trade failed {symbol}: {e}", exc_info=True)
            # If the order was placed before the exception, save it
            if order is not None:
                order_id = order.get("id")
                if order_id:
                    await self.db.save_failed_live_order(
                        user_id=self.user_id,
                        exchange_name=self.connector.exchange_name,
                        market_type=self.market_type,
                        symbol=symbol,
                        side=signal.lower(),
                        quantity=quantity,
                        entry_price=price,
                        exchange_order_id=order_id,
                        fail_reason=f"exception_after_order: {str(e)[:200]}",
                        cancel_attempted=False,
                        cancel_succeeded=False,
                    )
            raise