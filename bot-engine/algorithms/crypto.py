import pandas as pd
import pandas_ta as ta
import logging
from typing import Optional, Dict
from algorithms.base_algo import BaseAlgo

logger = logging.getLogger(__name__)

class CryptoAlgo(BaseAlgo):
    """
    Multi-Timeframe RSI + Bollinger Band Squeeze strategy.

    Logic:
    - Check 4H trend direction (EMA200 slope)
    - On 15M: RSI oversold + BB lower band touch → BUY in uptrend
    - On 15M: RSI overbought + BB upper band touch → SELL in downtrend
    - ATR-based dynamic stop loss
    """

    @property
    def market_type(self) -> str:
        return "crypto"

    def config_filename(self) -> str:
        return "crypto.json"

    def default_config(self) -> Dict:
        return {
            "algo_name":       "Multi-TF RSI + Bollinger Bands",
            "enabled":         True,
            "paper_mode":      True,
            "quote_currency":  "USDT",
            "symbols":         ["BTC/USDT", "ETH/USDT"],
            "timeframe":       "15m",
            "trend_timeframe": "4h",
            "indicators": {
                "rsi":        { "period": 14, "oversold": 30, "overbought": 70 },
                "bb":         { "length": 20, "std": 2.0 },
                "ema_trend":  { "period": 200 },
                "atr":        { "period": 14, "multiplier": 1.5 }
            },
            "min_confidence": 60
        }

    def get_symbols(self) -> list[str]:
        return self.config.get("symbols", ["BTC/USDT"])

    async def generate_signal(self, symbol: str) -> Optional[str]:
        cfg  = self.config
        ind  = cfg.get("indicators", {})
        tf   = cfg.get("timeframe", "15m")
        ttf  = cfg.get("trend_timeframe", "4h")

        # ── Fetch candles ────────────────────────────────────────────────────
        df_trend = await self.connector.fetch_ohlcv(symbol, ttf, limit=250)
        df       = await self.connector.fetch_ohlcv(symbol, tf,  limit=100)

        if len(df) < 30 or len(df_trend) < 210:
            return None

        # ── Trend direction (4H EMA200) ───────────────────────────────────
        ema_period  = ind.get("ema_trend", {}).get("period", 200)
        df_trend["ema200"] = ta.ema(df_trend["close"], length=ema_period)
        trend_up    = df_trend["close"].iloc[-1] > df_trend["ema200"].iloc[-1]
        trend_down  = not trend_up

        # ── 15M indicators ───────────────────────────────────────────────
        rsi_cfg = ind.get("rsi", {})
        rsi_p   = rsi_cfg.get("period", 14)
        rsi_os  = rsi_cfg.get("oversold", 30)
        rsi_ob  = rsi_cfg.get("overbought", 70)

        bb_cfg  = ind.get("bb", {})
        bb_len  = bb_cfg.get("length", 20)
        bb_std  = bb_cfg.get("std", 2.0)

        df["rsi"] = ta.rsi(df["close"], length=rsi_p)
        bb        = ta.bbands(df["close"], length=bb_len, std=bb_std)
        if bb is None:
            return None

        df["bb_lower"] = bb[f"BBL_{bb_len}_{bb_std}"]
        df["bb_upper"] = bb[f"BBU_{bb_len}_{bb_std}"]
        df["bb_mid"]   = bb[f"BBM_{bb_len}_{bb_std}"]

        latest = df.iloc[-1]
        prev   = df.iloc[-2]

        rsi_now    = latest["rsi"]
        close_now  = latest["close"]
        bb_lower   = latest["bb_lower"]
        bb_upper   = latest["bb_upper"]

        if pd.isna(rsi_now) or pd.isna(bb_lower):
            return None

        # ── Signals ──────────────────────────────────────────────────────
        buy_signal = (
            trend_up and
            rsi_now < rsi_os and
            close_now <= bb_lower * 1.005  # price at or near lower BB
        )

        sell_signal = (
            trend_down and
            rsi_now > rsi_ob and
            close_now >= bb_upper * 0.995  # price at or near upper BB
        )

        if buy_signal:
            logger.debug(f"[Crypto] BUY signal: RSI={rsi_now:.1f} trend_up={trend_up}")
            return "buy"
        if sell_signal:
            logger.debug(f"[Crypto] SELL signal: RSI={rsi_now:.1f} trend_up={trend_up}")
            return "sell"

        return None