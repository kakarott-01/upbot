import pandas as pd
import pandas_ta as ta
import logging
from typing import Optional, Dict
from datetime import datetime
import pytz
from algorithms.base_algo import BaseAlgo

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

class CommoditiesAlgo(BaseAlgo):
    """
    VWAP + MACD Signal Line Crossover for MCX commodities.

    Logic:
    - Price above VWAP + MACD crossover up + histogram positive → BUY
    - Price below VWAP + MACD crossover down                    → SELL
    - Respects MCX trading hours (9 AM – 11:30 PM for bullion/energy)
    - Higher margin awareness — smaller position sizes
    """

    @property
    def market_type(self) -> str:
        return "commodities"

    def config_filename(self) -> str:
        return "commodities.json"

    def default_config(self) -> Dict:
        return {
            "algo_name":      "VWAP + MACD Crossover",
            "enabled":        True,
            "paper_mode":     True,
            "quote_currency": "INR",
            "symbols":        ["GOLD", "SILVER", "CRUDEOIL"],
            "timeframe":      "15m",
            "indicators": {
                "macd": { "fast": 12, "slow": 26, "signal": 9 },
                "vwap": { "enabled": True }
            },
            "trading_hours": {
                "start": "09:00",
                "end":   "23:25"
            }
        }

    def get_symbols(self) -> list[str]:
        return self.config.get("symbols", ["GOLD"])

    def _is_trading_time(self) -> bool:
        now   = datetime.now(IST).strftime("%H:%M")
        hours = self.config.get("trading_hours", {})
        return hours.get("start", "09:00") <= now <= hours.get("end", "23:25")

    async def generate_signal(self, symbol: str) -> Optional[str]:
        if not self._is_trading_time():
            return None

        cfg = self.config
        ind = cfg.get("indicators", {})
        tf  = cfg.get("timeframe", "15m")

        df = await self.connector.fetch_ohlcv(symbol, tf, limit=100)

        if len(df) < 35:
            return None

        # ── MACD ─────────────────────────────────────────────────────────
        macd_cfg = ind.get("macd", {})
        macd = ta.macd(
            df["close"],
            fast   = macd_cfg.get("fast",   12),
            slow   = macd_cfg.get("slow",   26),
            signal = macd_cfg.get("signal",  9),
        )
        if macd is None:
            return None

        df["macd"]        = macd["MACD_12_26_9"]
        df["macd_signal"] = macd["MACDs_12_26_9"]
        df["macd_hist"]   = macd["MACDh_12_26_9"]

        # ── VWAP ─────────────────────────────────────────────────────────
        df["vwap"] = ta.vwap(df["high"], df["low"], df["close"], df["volume"])

        curr = df.iloc[-1]
        prev = df.iloc[-2]

        if any(pd.isna([curr["macd"], curr["macd_signal"], curr["vwap"]])):
            return None

        # ── Crossover detection ──────────────────────────────────────────
        macd_crossed_up   = (prev["macd"] <= prev["macd_signal"] and
                             curr["macd"] >  curr["macd_signal"])
        macd_crossed_down = (prev["macd"] >= prev["macd_signal"] and
                             curr["macd"] <  curr["macd_signal"])

        price_above_vwap = curr["close"] > curr["vwap"]
        price_below_vwap = curr["close"] < curr["vwap"]
        hist_positive    = curr["macd_hist"] > 0

        # ── Signals ──────────────────────────────────────────────────────
        if macd_crossed_up and price_above_vwap and hist_positive:
            logger.debug(f"[Commodities] BUY {symbol}: MACD cross + above VWAP")
            return "buy"

        if macd_crossed_down and price_below_vwap:
            logger.debug(f"[Commodities] SELL {symbol}: MACD cross + below VWAP")
            return "sell"

        return None