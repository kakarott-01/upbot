"""
bot-engine/workers/watchdog.py
================================
Background watchdog that runs every 60 seconds.

Responsibilities:
1. Detect bots whose heartbeat hasn't updated in > 3 minutes (stuck/dead)
2. Restart them automatically — with a MAX RESTART GUARD (max 3 attempts)
3. Log health summaries

Bug fixed: no max-retry guard meant if an exchange was down or keys were
invalid, the watchdog would restart the bot every 3 minutes forever,
flooding logs and DB writes. Now it gives up after MAX_RESTARTS and marks
the bot as error so the UI reflects the real state. The counter resets
when the bot produces a healthy heartbeat.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Dict

if TYPE_CHECKING:
    from scheduler import BotScheduler
    from db import Database

logger = logging.getLogger(__name__)

HEARTBEAT_TIMEOUT_SECONDS = 180   # restart bot if no heartbeat for 3 minutes
WATCHDOG_INTERVAL_SECONDS =  60   # check every 60 seconds
MAX_RESTARTS              =   3   # give up after this many consecutive restart attempts


class Watchdog:
    def __init__(self, scheduler: "BotScheduler", db: "Database"):
        self._scheduler = scheduler
        self._db        = db
        self._running   = False
        # Track consecutive restart attempts per user so we don't loop forever
        # when the exchange API is down or keys are invalid.
        # Reset to 0 when a healthy heartbeat is seen.
        self._restart_counts: Dict[str, int] = {}

    def stop(self):
        self._running = False

    async def run(self):
        self._running = True
        logger.info(f"🐕 Watchdog running (checks every {WATCHDOG_INTERVAL_SECONDS}s, max restarts={MAX_RESTARTS})")

        while self._running:
            await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)
            try:
                await self._check()
            except Exception as e:
                logger.error(f"🐕 Watchdog error (non-fatal): {e}", exc_info=True)

    async def _check(self):
        contexts = self._scheduler.get_all_contexts()
        if not contexts:
            return

        now     = datetime.utcnow()
        timeout = timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS)

        for user_id, ctx in contexts.items():
            if ctx.last_heartbeat is None:
                # Bot just started — give it 2 full cycles before checking
                elapsed = now - ctx.started_at
                if elapsed < timeout:
                    continue

            elif (now - ctx.last_heartbeat) < timeout:
                # Heartbeat is fresh — reset restart counter and continue
                if self._restart_counts.get(user_id, 0) > 0:
                    logger.info(
                        f"🐕 {user_id[:8]}… heartbeat recovered — resetting restart counter"
                    )
                    self._restart_counts[user_id] = 0

                logger.debug(
                    f"🐕 {user_id[:8]}… heartbeat OK "
                    f"({int((now - ctx.last_heartbeat).total_seconds())}s ago)"
                )
                continue

            # ── Heartbeat is stale ────────────────────────────────────────

            # Check if we've already hit the restart limit for this user
            current_count = self._restart_counts.get(user_id, 0)
            if current_count >= MAX_RESTARTS:
                logger.error(
                    f"🐕 GIVING UP on user={user_id[:8]}… "
                    f"after {current_count} consecutive restart attempts. "
                    "Marking bot as error — manual intervention required."
                )
                try:
                    await self._db.update_bot_status(
                        user_id, "error", ctx.markets,
                        error=(
                            f"Watchdog gave up after {current_count} restart attempts. "
                            "Check exchange API keys and logs."
                        )
                    )
                    await self._scheduler.stop_user_bot(user_id)
                except Exception as e:
                    logger.error(f"🐕 Failed to mark error state for {user_id[:8]}…: {e}")
                # Reset count so the user can try starting manually again later
                self._restart_counts[user_id] = 0
                continue

            # Attempt restart
            since = ctx.last_heartbeat or ctx.started_at
            logger.warning(
                f"🐕 DEAD BOT DETECTED user={user_id[:8]}… "
                f"last heartbeat {int((now - since).total_seconds())}s ago — "
                f"restarting (attempt {current_count + 1}/{MAX_RESTARTS})"
            )

            self._restart_counts[user_id] = current_count + 1

            try:
                markets = ctx.markets
                await self._scheduler.stop_user_bot(user_id)
                await asyncio.sleep(2)
                await self._scheduler.start_user_bot(user_id, markets)
                logger.info(
                    f"🐕 Bot restarted for user={user_id[:8]}… markets={markets} "
                    f"(attempt {current_count + 1}/{MAX_RESTARTS})"
                )
            except Exception as e:
                logger.error(
                    f"🐕 Restart attempt {current_count + 1} failed for "
                    f"user={user_id[:8]}…: {e}",
                    exc_info=True,
                )
                await self._db.update_bot_status(
                    user_id, "error", ctx.markets,
                    error=f"Watchdog restart attempt {current_count + 1} failed: {e}"
                )