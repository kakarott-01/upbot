import asyncio
import logging
from typing import Dict, List
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from exchange_connector import ExchangeConnector
from risk_manager import RiskManager
from algorithms.indian_markets import IndianMarketsAlgo
from algorithms.crypto import CryptoAlgo
from algorithms.commodities import CommoditiesAlgo
from algorithms.global_general import GlobalAlgo
from db import Database

logger = logging.getLogger(__name__)

ALGO_MAP = {
    "indian":      IndianMarketsAlgo,
    "crypto":      CryptoAlgo,
    "commodities": CommoditiesAlgo,
    "global":      GlobalAlgo,
}

class BotScheduler:
    def __init__(self):
        self.scheduler   = AsyncIOScheduler()
        self.active_jobs: Dict[str, list] = {}  # user_id -> [job_ids]
        self.db          = Database()
        self.scheduler.start()
        logger.info("BotScheduler started")

    async def start_user_bot(self, user_id: str, markets: List[str]):
        # Stop existing jobs for this user first
        self.stop_user_bot(user_id)
        self.active_jobs[user_id] = []

        # Load exchange APIs for this user from DB
        exchange_configs = await self.db.get_exchange_apis(user_id)
        risk_cfg         = await self.db.get_risk_settings(user_id)
        risk_mgr         = RiskManager(risk_cfg)

        for market in markets:
            cfg = exchange_configs.get(market)
            if not cfg:
                logger.warning(f"No exchange API for user {user_id} market {market}")
                continue

            AlgoClass   = ALGO_MAP.get(market, GlobalAlgo)
            connector   = ExchangeConnector(cfg["exchange_name"], cfg["api_key"], cfg["api_secret"])
            algo        = AlgoClass(connector, risk_mgr, self.db, user_id)

            interval = 60 if market == "indian" else 30  # seconds between cycles

            job = self.scheduler.add_job(
                algo.run_cycle,
                trigger=IntervalTrigger(seconds=interval),
                id=f"{user_id}_{market}",
                replace_existing=True,
                max_instances=1,
            )
            self.active_jobs[user_id].append(f"{user_id}_{market}")
            logger.info(f"Started bot for user={user_id} market={market} interval={interval}s")

        await self.db.update_bot_status(user_id, "running", markets)

    def stop_user_bot(self, user_id: str):
        for job_id in self.active_jobs.get(user_id, []):
            try:
                self.scheduler.remove_job(job_id)
            except Exception:
                pass
        self.active_jobs.pop(user_id, None)
        asyncio.create_task(self.db.update_bot_status(user_id, "stopped", []))
        logger.info(f"Stopped bot for user={user_id}")

    def stop_all(self):
        for user_id in list(self.active_jobs.keys()):
            self.stop_user_bot(user_id)

    def get_status(self, user_id: str) -> dict:
        jobs = self.active_jobs.get(user_id, [])
        return {
            "user_id":  user_id,
            "running":  len(jobs) > 0,
            "markets":  [j.split("_", 1)[1] for j in jobs],
            "job_count":len(jobs),
        }