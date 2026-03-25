import pandas as pd
import pandas_ta as ta
import logging
from typing import Optional, Dict
from algorithms.base_algo import BaseAlgo

logger = logging.getLogger(__name__)

class GlobalAlgo(BaseAlgo):
    """
    Universal Trend-Following strategy — works on any market/asset class.

    Logic:
    - 50 EMA above 200 EMA → bullish regime
    - RSI pullback to 40-50 zone in bullish regime → BUY entry
    - RSI pushback to 50-60 zone in bearish regime → SELL entry
    - ATR trailing stop loss
    - Works on US/UK stocks, bonds, forex, crypto, indices
    """

    @property
    def market_type(self) -> str:
        return "global"

    def config_filename(self) -> str:
        return "global_general.json"

    def default_config(self) -> Dict:
        return {
            "algo_name":      "Universal Trend Follower",
            "enabled":        True,
            "paper_mode":     True,
            "quote_currency": "USDT",
            "symbols":        ["BTC/USDT", "ETH/USDT"],
            "timeframe":      "1h",
            "indicators": {
                "ema_fast":  { "period": 50 },
                "ema_slow":  { "period": 200 },
                "rsi":       { "period": 14,
                                "buy_zone_low":  40,
                                "buy_zone_high": 55,
                                "sell_zone_low": 45,
                                "sell_zone_high":60 },
                "atr":       { "period": 14 }
            }
        }

    def get_symbols(self) -> list[str]:
        return self.config.get("symbols", ["BTC/USDT"])

    async def generate_signal(self, symbol: str) -> Optional[str]:
        cfg = self.config
        ind = cfg.get("indicators", {})
        tf  = cfg.get("timeframe", "1h")

        df = await self.connector.fetch_ohlcv(symbol, tf, limit=250)

        if len(df) < 210:
            return None

        # ── Indicators ───────────────────────────────────────────────────
        fast_p = ind.get("ema_fast", {}).get("period", 50)
        slow_p = ind.get("ema_slow", {}).get("period", 200)
        rsi_p  = ind.get("rsi", {}).get("period", 14)
        rsi_cfg= ind.get("rsi", {})

        df["ema_fast"] = ta.ema(df["close"], length=fast_p)
        df["ema_slow"] = ta.ema(df["close"], length=slow_p)
        df["rsi"]      = ta.rsi(df["close"], length=rsi_p)

        curr = df.iloc[-1]
        prev = df.iloc[-2]

        if any(pd.isna([curr["ema_fast"], curr["ema_slow"], curr["rsi"]])):
            return None

        # ── Regime detection ─────────────────────────────────────────────
        bullish_regime = curr["ema_fast"] > curr["ema_slow"]
        bearish_regime = not bullish_regime

        rsi_now    = curr["rsi"]
        buy_low    = rsi_cfg.get("buy_zone_low",   40)
        buy_high   = rsi_cfg.get("buy_zone_high",  55)
        sell_low   = rsi_cfg.get("sell_zone_low",  45)
        sell_high  = rsi_cfg.get("sell_zone_high", 60)

        # ── RSI pullback entry in trend direction ─────────────────────
        rsi_in_buy_zone  = buy_low  <= rsi_now <= buy_high
        rsi_in_sell_zone = sell_low <= rsi_now <= sell_high

        # Require RSI to be moving in the right direction
        rsi_rising  = rsi_now > prev["rsi"]
        rsi_falling = rsi_now < prev["rsi"]

        if bullish_regime and rsi_in_buy_zone and rsi_rising:
            logger.debug(f"[Global] BUY {symbol}: bullish regime RSI={rsi_now:.1f} rising")
            return "buy"

        if bearish_regime and rsi_in_sell_zone and rsi_falling:
            logger.debug(f"[Global] SELL {symbol}: bearish regime RSI={rsi_now:.1f} falling")
            return "sell"

        return None