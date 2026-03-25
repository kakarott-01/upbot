import pandas as pd
import pandas_ta as ta
import logging
from typing import Optional, Dict
from datetime import datetime
import pytz
from algorithms.base_algo import BaseAlgo

logger = logging.getLogger(__name__)

IST = pytz.timezone("Asia/Kolkata")

class IndianMarketsAlgo(BaseAlgo):
    """
    EMA Crossover + RSI Filter + Volume Confirmation strategy for NSE/BSE.

    Logic:
    - EMA 9 crosses above EMA 21 + RSI > 50 + volume spike → BUY
    - EMA 9 crosses below EMA 21 + RSI < 50               → SELL
    - Auto square-off all positions at 3:15 PM IST (15 min before NSE close)
    - No trades before 9:20 AM IST (avoid opening volatility)
    """

    @property
    def market_type(self) -> str:
        return "indian"

    def config_filename(self) -> str:
        return "indian_markets.json"

    def default_config(self) -> Dict:
        return {
            "algo_name":      "EMA Crossover + RSI + Volume",
            "enabled":        True,
            "paper_mode":     True,
            "quote_currency": "INR",
            "symbols":        ["RELIANCE", "TCS", "INFY", "HDFCBANK"],
            "timeframe":      "5m",
            "indicators": {
                "ema_fast":  { "period": 9 },
                "ema_slow":  { "period": 21 },
                "rsi":       { "period": 14, "threshold": 50 },
                "volume":    { "avg_period": 20, "spike_multiplier": 1.5 }
            },
            "trading_hours": {
                "start": "09:20",
                "end":   "15:15",
                "square_off": "15:15"
            }
        }

    def get_symbols(self) -> list[str]:
        return self.config.get("symbols", ["RELIANCE"])

    def _is_trading_time(self) -> tuple[bool, bool]:
        """Returns (can_trade, should_square_off)."""
        now        = datetime.now(IST).strftime("%H:%M")
        hours      = self.config.get("trading_hours", {})
        start      = hours.get("start", "09:20")
        end        = hours.get("end",   "15:15")
        square_off = hours.get("square_off", "15:15")

        if now >= square_off:
            return False, True
        if now < start:
            return False, False
        return True, False

    async def generate_signal(self, symbol: str) -> Optional[str]:
        can_trade, should_square_off = self._is_trading_time()

        if should_square_off:
            logger.info(f"[IndianMarkets] Square-off time reached for {symbol}")
            return "sell"   # close any open position at EOD

        if not can_trade:
            return None

        cfg = self.config
        ind = cfg.get("indicators", {})
        tf  = cfg.get("timeframe", "5m")

        df = await self.connector.fetch_ohlcv(symbol, tf, limit=60)

        if len(df) < 25:
            return None

        # ── Indicators ───────────────────────────────────────────────────
        fast_p = ind.get("ema_fast", {}).get("period", 9)
        slow_p = ind.get("ema_slow", {}).get("period", 21)
        rsi_p  = ind.get("rsi", {}).get("period", 14)
        rsi_th = ind.get("rsi", {}).get("threshold", 50)
        vol_p  = ind.get("volume", {}).get("avg_period", 20)
        vol_mx = ind.get("volume", {}).get("spike_multiplier", 1.5)

        df["ema_fast"] = ta.ema(df["close"], length=fast_p)
        df["ema_slow"] = ta.ema(df["close"], length=slow_p)
        df["rsi"]      = ta.rsi(df["close"], length=rsi_p)
        df["vol_avg"]  = df["volume"].rolling(vol_p).mean()

        curr = df.iloc[-1]
        prev = df.iloc[-2]

        if any(pd.isna([curr["ema_fast"], curr["ema_slow"], curr["rsi"]])):
            return None

        # ── Crossover detection ──────────────────────────────────────────
        ema_crossed_up   = prev["ema_fast"] <= prev["ema_slow"] and curr["ema_fast"] > curr["ema_slow"]
        ema_crossed_down = prev["ema_fast"] >= prev["ema_slow"] and curr["ema_fast"] < curr["ema_slow"]

        volume_spike = curr["volume"] > curr["vol_avg"] * vol_mx

        rsi_bullish  = curr["rsi"] > rsi_th
        rsi_bearish  = curr["rsi"] < rsi_th

        # ── Signals ──────────────────────────────────────────────────────
        if ema_crossed_up and rsi_bullish and volume_spike:
            logger.debug(f"[IndianMarkets] BUY {symbol}: EMA cross + RSI={curr['rsi']:.1f} + vol spike")
            return "buy"

        if ema_crossed_down and rsi_bearish:
            logger.debug(f"[IndianMarkets] SELL {symbol}: EMA cross + RSI={curr['rsi']:.1f}")
            return "sell"

        return None