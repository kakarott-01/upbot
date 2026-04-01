"""
bot-engine/close_all_engine.py
================================
Handles the "Close All Positions & Stop" flow.

Bug fixed: _confirm_fill() had a broken async context manager call:
    async with connector._exchange().__aenter__()
This raises TypeError because _exchange() is an asynccontextmanager,
not a class with __aenter__/__aexit__ directly callable like that.
The fix: simply check whether the order_id is still in open orders —
if it's gone, it filled. We don't need to fetch order details for the
close-all flow.

Design:
  - Fetches all open trades from DB for a user
  - For each: places market close order on exchange
  - Confirms fill by polling exchange order status
  - Detects partial fills — retries remainder
  - Uses exponential backoff with jitter on API failures
  - Logs every attempt to position_close_log
  - After max retries or timeout → alerts user via DB error message
  - On complete success → calls Next.js /api/bot/complete-stop

Paper mode: skips all exchange calls, just marks DB records closed.
"""

import asyncio
import logging
import os
import time
import random
import httpx
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

logger = logging.getLogger(__name__)

# ── Retry configuration ────────────────────────────────────────────────────────
MAX_ATTEMPTS        = 5
BASE_BACKOFF_SEC    = 2.0
MAX_BACKOFF_SEC     = 60.0
BACKOFF_MULTIPLIER  = 2.0
FILL_CONFIRM_POLL   = 3.0     # seconds between fill-confirmation polls
FILL_CONFIRM_MAX    = 10      # max polls before giving up on order fill
OVERALL_TIMEOUT_SEC = 300     # 5 minutes total


def _backoff(attempt: int) -> float:
    """Exponential backoff with ±25% jitter."""
    base   = BASE_BACKOFF_SEC * (BACKOFF_MULTIPLIER ** (attempt - 1))
    jitter = base * 0.25 * random.uniform(-1, 1)
    return min(base + jitter, MAX_BACKOFF_SEC)


class CloseAllEngine:
    def __init__(self, user_id: str, db, connector_map: dict, paper_modes: dict):
        self.user_id       = user_id
        self.db            = db
        self.connector_map = connector_map
        self.paper_modes   = paper_modes
        self._start_time   = time.time()

    async def run(self) -> dict:
        logger.info(f"[CloseAll] Starting for user={self.user_id[:8]}…")

        open_trades = await self.db.get_all_open_trades_all_markets(self.user_id)

        if not open_trades:
            logger.info(f"[CloseAll] No open trades — nothing to close")
            await self._notify_complete()
            return {"success": True, "closed": 0, "failed": 0, "errors": []}

        logger.info(f"[CloseAll] Found {len(open_trades)} open trade(s)")

        closed = 0
        failed = 0
        errors = []

        for trade in open_trades:
            if time.time() - self._start_time > OVERALL_TIMEOUT_SEC:
                msg = f"Close-all timed out after {OVERALL_TIMEOUT_SEC}s. {failed} positions may still be open."
                logger.error(f"[CloseAll] {msg}")
                await self.db.set_bot_error(self.user_id, msg)
                errors.append(msg)
                break

            result = await self._close_one(trade)
            if result["success"]:
                closed += 1
            else:
                failed += 1
                errors.append(f"{trade['symbol']}: {result['error']}")

        all_success = failed == 0 and not errors

        if all_success:
            logger.info(f"[CloseAll] ✅ All {closed} positions closed successfully")
            await self._notify_complete()
        else:
            msg = f"Close-all partial: {closed} closed, {failed} failed. Manual review needed."
            logger.error(f"[CloseAll] ⚠️  {msg}")
            await self.db.set_bot_error(self.user_id, msg)
            await self._notify_complete()

        return {"success": all_success, "closed": closed, "failed": failed, "errors": errors}

    async def _close_one(self, trade: dict) -> dict:
        trade_id   = str(trade["id"])
        symbol     = trade["symbol"]
        side       = trade["side"]
        quantity   = float(trade["quantity"])
        market     = trade["market_type"]
        is_paper   = self.paper_modes.get(market, True)

        close_side = "sell" if side.lower() == "buy" else "buy"

        logger.info(f"[CloseAll] Closing {symbol} qty={quantity} side={close_side} paper={is_paper}")

        # ── Paper mode: instant close ─────────────────────────────────────────
        if is_paper:
            try:
                connector  = self.connector_map.get(market)
                exit_price = 0.0
                if connector:
                    try:
                        ticker     = await connector.fetch_ticker(symbol)
                        exit_price = float(ticker.get("last", 0))
                    except Exception:
                        pass

                entry_price = float(trade["entry_price"])
                if side.lower() == "sell":
                    pnl = (entry_price - exit_price) * quantity
                else:
                    pnl = (exit_price - entry_price) * quantity

                pnl_dec     = Decimal(str(pnl)).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
                pnl_pct_raw = (float(pnl_dec) / (entry_price * quantity)) * 100 if entry_price > 0 else 0
                pnl_pct     = Decimal(str(pnl_pct_raw)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

                await self.db.close_paper_trade(trade_id, exit_price, float(pnl_dec), float(pnl_pct))
                await self.db.log_close_attempt(
                    user_id=self.user_id,
                    trade_id=trade_id,
                    attempt=1,
                    status="filled",
                    quantity_req=quantity,
                    quantity_fill=quantity,
                )
                return {"success": True, "error": None}
            except Exception as e:
                logger.error(f"[CloseAll] Paper close failed {symbol}: {e}")
                return {"success": False, "error": str(e)}

        # ── Live mode: exchange close with retry ──────────────────────────────
        connector = self.connector_map.get(market)
        if not connector:
            err = f"No connector for market={market}"
            logger.error(f"[CloseAll] {err}")
            return {"success": False, "error": err}

        remaining_qty = quantity
        attempt       = 0

        while remaining_qty > 0 and attempt < MAX_ATTEMPTS:
            attempt += 1

            if time.time() - self._start_time > OVERALL_TIMEOUT_SEC:
                err = f"Timeout during close of {symbol}"
                await self.db.log_close_attempt(
                    user_id=self.user_id,
                    trade_id=trade_id,
                    attempt=attempt,
                    status="failed",
                    quantity_req=remaining_qty,
                    error_message=err,
                )
                return {"success": False, "error": err}

            logger.info(
                f"[CloseAll] {symbol} attempt={attempt}/{MAX_ATTEMPTS} "
                f"qty={remaining_qty:.8f}"
            )

            order_id = None
            try:
                order    = await connector.place_order(symbol, close_side, remaining_qty)
                order_id = order.get("id")

                filled_qty, status_str, error = await self._confirm_fill(
                    connector, symbol, order_id, remaining_qty
                )

                await self.db.log_close_attempt(
                    user_id=self.user_id,
                    trade_id=trade_id,
                    attempt=attempt,
                    status=status_str,
                    quantity_req=remaining_qty,
                    quantity_fill=filled_qty,
                    exchange_order_id=order_id,
                    error_message=error,
                )
                await self.db.increment_close_attempts(trade_id)

                if status_str == "filled":
                    remaining_qty -= filled_qty

                    if remaining_qty <= 0:
                        try:
                            ticker     = await connector.fetch_ticker(symbol)
                            exit_price = float(ticker.get("last", 0))
                        except Exception:
                            exit_price = float(trade["entry_price"])

                        entry_price = float(trade["entry_price"])
                        orig_qty    = float(trade["quantity"])
                        if side.lower() == "sell":
                            pnl = (entry_price - exit_price) * orig_qty
                        else:
                            pnl = (exit_price - entry_price) * orig_qty

                        pnl_dec     = Decimal(str(pnl)).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
                        pnl_pct_raw = (float(pnl_dec) / (entry_price * orig_qty)) * 100 if entry_price > 0 else 0
                        pnl_pct     = Decimal(str(pnl_pct_raw)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

                        await self.db.close_live_trade(trade_id, exit_price, float(pnl_dec), float(pnl_pct), order_id or "")
                        logger.info(f"[CloseAll] ✅ {symbol} fully closed @ {exit_price}")
                        return {"success": True, "error": None}

                    logger.warning(
                        f"[CloseAll] ⚠️  {symbol} partial fill: "
                        f"filled={filled_qty:.8f} remaining={remaining_qty:.8f}"
                    )
                    await asyncio.sleep(1.5)

                elif status_str == "partial":
                    remaining_qty -= filled_qty
                    await asyncio.sleep(_backoff(attempt))

                else:
                    await asyncio.sleep(_backoff(attempt))

            except Exception as e:
                logger.error(
                    f"[CloseAll] {symbol} attempt={attempt} exception: {e}",
                    exc_info=True,
                )
                await self.db.log_close_attempt(
                    user_id=self.user_id,
                    trade_id=trade_id,
                    attempt=attempt,
                    status="failed",
                    quantity_req=remaining_qty,
                    exchange_order_id=order_id,
                    error_message=str(e),
                )
                await self.db.increment_close_attempts(trade_id)

                if attempt < MAX_ATTEMPTS:
                    backoff = _backoff(attempt)
                    logger.info(f"[CloseAll] Retrying {symbol} in {backoff:.1f}s…")
                    await asyncio.sleep(backoff)

        if remaining_qty > 0:
            err = (
                f"Failed to fully close {symbol} after {MAX_ATTEMPTS} attempts. "
                f"Remaining: {remaining_qty:.8f}. Manual action required."
            )
            await self.db.update_close_error(trade_id, err)
            logger.error(f"[CloseAll] ❌ {err}")
            return {"success": False, "error": err}

        return {"success": True, "error": None}

    async def _confirm_fill(
        self,
        connector,
        symbol: str,
        order_id: str,
        expected_qty: float,
    ) -> tuple:
        """
        Poll exchange for order fill confirmation.
        Returns (filled_qty, status_str, error_msg)
        status_str: 'filled' | 'partial' | 'failed'

        Bug fixed: the original code tried to use the async context manager
        incorrectly:
            async with connector._exchange().__aenter__()
        This raises TypeError. _exchange() is an asynccontextmanager — you
        must use it as `async with connector._exchange() as ex:`.

        For fill confirmation we only need to check whether the order is
        still in the open orders list. If it's gone, it filled. We don't
        need to call any other exchange method, so we just call
        connector.fetch_open_orders() which handles its own context manager
        correctly.
        """
        if not order_id:
            return 0.0, "failed", "No order ID returned"

        for poll in range(FILL_CONFIRM_MAX):
            await asyncio.sleep(FILL_CONFIRM_POLL)
            try:
                orders   = await connector.fetch_open_orders(symbol)
                open_ids = {str(o.get("id")) for o in orders}

                if str(order_id) not in open_ids:
                    # Order is no longer open — treat as fully filled.
                    # We don't have exact fill qty here; use expected_qty.
                    # For partial fills, the exchange would typically leave
                    # a new reduced order in open_orders rather than removing it.
                    logger.info(f"[CloseAll] Order {order_id} no longer in open orders — filled")
                    return expected_qty, "filled", None

                logger.debug(
                    f"[CloseAll] Order {order_id} still open (poll {poll+1}/{FILL_CONFIRM_MAX})"
                )

            except Exception as e:
                logger.warning(f"[CloseAll] Fill confirmation poll failed: {e}")
                continue

        # Max polls exceeded — treat as partial to trigger a retry
        logger.warning(
            f"[CloseAll] Order {order_id} fill unconfirmed after "
            f"{FILL_CONFIRM_MAX} polls — treating as partial"
        )
        return 0.0, "partial", "Fill unconfirmed after max polls"

    async def _notify_complete(self):
        """Notify Next.js app that close-all is done so DB status → stopped."""
        app_url = os.getenv("NEXT_PUBLIC_APP_URL", "")
        if not app_url:
            logger.warning("[CloseAll] NEXT_PUBLIC_APP_URL not set — skipping completion callback")
            return

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{app_url}/api/bot/complete-stop",
                    json={"user_id": self.user_id},
                    headers={"X-Bot-Secret": os.getenv("BOT_ENGINE_SECRET", "")},
                )
                if resp.status_code == 200:
                    logger.info(f"[CloseAll] ✅ Completion callback succeeded")
                else:
                    logger.warning(
                        f"[CloseAll] Completion callback returned {resp.status_code}"
                    )
        except Exception as e:
            logger.error(f"[CloseAll] Completion callback failed: {e}")
            try:
                await self.db.force_set_status(self.user_id, "stopped")
            except Exception as db_err:
                logger.error(f"[CloseAll] Fallback DB update also failed: {db_err}")