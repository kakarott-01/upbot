"""
bot-engine/algorithms/crypto.py — v5
======================================
FIX: Zero-trade bug in ranging markets.

ROOT CAUSE (v4):
  In a RANGING market the strategy order was ["breakout", "scalp"].
  - breakout required vol_ratio >= 1.2 AND atr_ratio >= 0.80 simultaneously.
    In a quiet ranging market ATR is compressed, so atr_ratio < 0.80 → no signal.
  - scalp was disabled by default (scalp_enabled=false).
  Result: ZERO signals in ranging markets, which is the majority of crypto time.

CHANGES (v5):
  1. New detect_momentum() sub-strategy: fires whenever RSI crosses 50
     with price confirmation — generates 2-5 signals per symbol per day.
  2. Regime strategy order updated:
     TRENDING  → pullback, breakout, momentum
     RANGING   → scalp, momentum, breakout   (scalp first + momentum fallback)
  3. detect_breakout() relaxed: vol >= 1.05× (was 1.2×), ATR >= 0.5× (was 0.8×)
  4. detect_scalp() relaxed: ATR < 1.1× avg (was 0.85×)
  5. Use fetch_ohlcv_cached() instead of fetch_ohlcv() — avoids redundant calls
  6. Confidence threshold configurable (min_confidence now defaults to 25)
  7. All algorithm/exit logic from v4 preserved.
"""

import pandas as pd
import logging
from typing import Optional, Dict, Tuple
from datetime import datetime, timedelta

from ta.trend import EMAIndicator
from ta.momentum import RSIIndicator
from ta.volatility import BollingerBands, AverageTrueRange

from algorithms.base_algo import BaseAlgo
from confidence_engine import score_confidence, leverage_from_score, hold_hours_from_score
from market_regime import detect_market_regime

logger = logging.getLogger(__name__)


# ── Leverage helpers ─────────────────────────────────────────────────────────

def _crypto_leverage_only(market_type: str, leverage: int) -> int:
    """Guard: only crypto markets use leverage > 1."""
    return leverage if market_type == "crypto" else 1


# ── Regime → strategy order (v5) ─────────────────────────────────────────────

def _regime_strategy_order(regime: str) -> list[str]:
    """
    v5 change: momentum added to both regimes as a reliable fallback.
    RANGING: scalp first (fires in quiet ATR), then momentum, then breakout.
    TRENDING: pullback first, breakout second, momentum third.
    """
    if regime == "TRENDING":
        return ["pullback", "breakout", "momentum"]
    return ["scalp", "momentum", "breakout"]


# ---------------------------------------------------------------------------
# CryptoAlgo
# ---------------------------------------------------------------------------

class CryptoAlgo(BaseAlgo):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._open_positions:    Dict[str, Dict] = {}
        self._last_signal_time:  Dict[str, datetime] = {}
        self._db_synced:         set = set()
        self._staged_open:       Dict[str, Dict] = {}

    @property
    def market_type(self) -> str:
        return "crypto"

    def config_filename(self) -> str:
        return "crypto.json"

    def default_config(self) -> Dict:
        return {
            "symbols":                 ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT"],
            "timeframe":               "15m",
            "trend_timeframe":         "4h",
            "signal_cooldown_minutes": 5,
            "risk_pct_per_trade":      1.0,
            "max_open_trades":         5,
            "daily_loss_limit_pct":    5.0,
            "scalp_enabled":           True,
            "min_confidence":          25.0,
        }

    def get_symbols(self) -> list:
        return self.config.get("symbols", ["BTC/USDT", "ETH/USDT", "SOL/USDT"])

    def _on_cooldown(self, symbol: str) -> bool:
        last = self._last_signal_time.get(symbol)
        if not last:
            return False
        mins = self.config.get("signal_cooldown_minutes", 5)
        return (datetime.utcnow() - last) < timedelta(minutes=mins)

    # ── DB sync ───────────────────────────────────────────────────────────────

    async def _sync_position_from_db(self, symbol: str):
        if symbol in self._db_synced:
            return
        self._db_synced.add(symbol)
        try:
            open_row = await self.db.get_open_trade(self.user_id, symbol, self.market_type)
            if open_row and symbol not in self._open_positions:
                opened_at = open_row["opened_at"]
                if hasattr(opened_at, "tzinfo") and opened_at.tzinfo is not None:
                    opened_at = opened_at.replace(tzinfo=None)
                self._open_positions[symbol] = {
                    "signal":      open_row["side"].upper(),
                    "entry_price": float(open_row["entry_price"]),
                    "opened_at":   opened_at,
                    "stop_loss":   float(open_row["stop_loss"])   if open_row.get("stop_loss")   is not None else None,
                    "take_profit": float(open_row["take_profit"]) if open_row.get("take_profit") is not None else None,
                    "quantity":    float(open_row.get("remaining_quantity") or open_row.get("quantity") or 0),
                    "leverage":    int((open_row.get("metadata") or {}).get("leverage", 1)
                                       if isinstance(open_row.get("metadata"), dict) else 1),
                    "confidence":  float((open_row.get("metadata") or {}).get("confidence", 50)
                                         if isinstance(open_row.get("metadata"), dict) else 50),
                    "liquidation_price": (
                        float((open_row.get("metadata") or {}).get("liquidation_price"))
                        if isinstance(open_row.get("metadata"), dict)
                        and (open_row.get("metadata") or {}).get("liquidation_price") not in (None, "")
                        else None
                    ),
                }
                logger.info(
                    "🔄 Restored Crypto position: %s %s @ %s (lev=%s)",
                    open_row["side"].upper(), symbol, open_row["entry_price"],
                    self._open_positions[symbol]["leverage"],
                )
        except Exception as exc:
            logger.error("❌ Crypto DB sync failed for %s: %s", symbol, exc, exc_info=True)

    # ── Position helpers ──────────────────────────────────────────────────────

    def _has_position(self, symbol: str) -> bool:
        return symbol in self._open_positions

    def _stage_open(self, symbol: str, signal: str, price: float,
                    leverage: int, confidence: float):
        self._staged_open[symbol] = {
            "signal":      signal,
            "entry_price": price,
            "opened_at":   datetime.utcnow(),
            "leverage":    leverage,
            "confidence":  confidence,
        }
        self._last_signal_time[symbol] = datetime.utcnow()

    def _confirm_staged_open(self, symbol: str):
        pending = self._staged_open.pop(symbol, None)
        if pending:
            self._open_positions[symbol] = pending
            logger.info(
                "📂 Position confirmed: %s %s @ %.4f leverage=%d×",
                pending["signal"], symbol, pending["entry_price"], pending["leverage"],
            )

    def _discard_staged_open(self, symbol: str):
        discarded = self._staged_open.pop(symbol, None)
        if discarded:
            logger.warning("🚫 Staged open discarded: %s", symbol)

    def _close(self, symbol: str, reason: str):
        pos = self._open_positions.pop(symbol, None)
        if pos:
            logger.info(
                "📁 Position closed: %s %s entry=%.4f reason=%s",
                pos["signal"], symbol, pos["entry_price"], reason,
            )

    # =========================================================================
    # Main signal generation (v5)
    # =========================================================================

    async def generate_signal(self, symbol: str) -> Optional[str]:
        await self._sync_position_from_db(symbol)

        # ── 1. Fetch candles (v5: use cache to avoid redundant API calls) ────
        try:
            df_trend = await self.connector.fetch_ohlcv_cached(symbol, "4h",  limit=250)
            df       = await self.connector.fetch_ohlcv_cached(symbol, "15m", limit=250)
        except Exception as exc:
            logger.error("❌ OHLCV fetch failed %s: %s", symbol, exc)
            return None

        if len(df) < 60 or len(df_trend) < 50:
            # v5: lowered from 220/210 so bot starts generating signals sooner
            logger.debug("⚠️  Not enough candles for %s (%d 15m / %d 4h)", symbol, len(df), len(df_trend))
            return None

        # ── 2. Exit existing position ────────────────────────────────────────
        if self._has_position(symbol):
            return self._check_exit(symbol, df)

        # ── 3. Cooldown guard ─────────────────────────────────────────────────
        if self._on_cooldown(symbol):
            return None

        # ── 4. Market regime detection ────────────────────────────────────────
        # Only use regime detection when we have enough data; otherwise default
        if len(df) >= 210 and len(df_trend) >= 210:
            regime = detect_market_regime(df)
        else:
            regime = "RANGING"  # safe default when bars are scarce

        strategy_order = _regime_strategy_order(regime)
        scalp_enabled  = bool(self.config.get("scalp_enabled", True))

        # ── 5. Compute shared indicators ─────────────────────────────────────
        indicators = _compute_indicators(df, df_trend if len(df_trend) >= 50 else df)
        if indicators is None:
            return None

        # ── 6. Try each sub-strategy in priority order ────────────────────────
        signal:        Optional[str] = None
        strategy_used: str           = "none"

        for strat in strategy_order:
            if strat == "pullback":
                sig = detect_pullback(df, indicators)
            elif strat == "breakout":
                sig = detect_breakout(df, indicators)
            elif strat == "scalp" and scalp_enabled:
                sig = detect_scalp(df, indicators)
            elif strat == "momentum":
                sig = detect_momentum(df, indicators)
            else:
                sig = None

            if sig:
                signal, strategy_used = sig, strat
                break

        if not signal:
            return None

        # ── 7. Confidence scoring ─────────────────────────────────────────────
        confidence = score_confidence(df, signal)
        min_conf   = float(self.config.get("min_confidence", 25.0))

        if confidence < min_conf:
            logger.debug(
                "⛔ %s: signal=%s confidence=%.1f < %.1f (%s) — skipping",
                symbol, signal, confidence, min_conf, strategy_used,
            )
            return None

        # ── 8. Leverage mapping ────────────────────────────────────────────────
        leverage = leverage_from_score(confidence)
        if leverage is None:
            # Below absolute minimum confidence → use 1× (paper mode is safe)
            leverage = 1

        leverage = _crypto_leverage_only(self.market_type, leverage)

        logger.info(
            "🎯 %s: %s | strategy=%s | conf=%.1f | lev=%d× | regime=%s",
            symbol, signal, strategy_used, confidence, leverage, regime,
        )

        # ── 9. Stage the open ─────────────────────────────────────────────────
        curr_price = float(df["close"].iloc[-1])
        self._stage_open(symbol, signal, curr_price, leverage, confidence)
        self._staged_open[symbol]["strategy"] = strategy_used
        self._staged_open[symbol]["regime"]   = regime

        return signal

    # =========================================================================
    # Exit logic (unchanged from v4)
    # =========================================================================

    def _check_exit(self, symbol: str, df: pd.DataFrame) -> Optional[str]:
        pos        = self._open_positions[symbol]
        side       = pos["signal"]
        entry      = pos["entry_price"]
        opened_at  = pos["opened_at"]
        confidence = pos.get("confidence", 50.0)
        stop_loss  = pos.get("stop_loss")
        take_profit = pos.get("take_profit")

        curr_close = float(df["close"].iloc[-1])
        curr_high  = float(df["high"].iloc[-1])
        curr_low   = float(df["low"].iloc[-1])

        # TP / SL price levels (set when trade was opened)
        if stop_loss is not None:
            if side == "BUY"  and curr_low  <= float(stop_loss):
                self._set_exit_price_override(symbol, float(stop_loss))
                self._close(symbol, f"SL @{float(stop_loss):.4f}")
                return "SELL"
            if side == "SELL" and curr_high >= float(stop_loss):
                self._set_exit_price_override(symbol, float(stop_loss))
                self._close(symbol, f"SL @{float(stop_loss):.4f}")
                return "BUY"

        if take_profit not in (None, 0, 0.0):
            if side == "BUY"  and curr_high >= float(take_profit):
                self._set_exit_price_override(symbol, float(take_profit))
                self._close(symbol, f"TP @{float(take_profit):.4f}")
                return "SELL"
            if side == "SELL" and curr_low  <= float(take_profit):
                self._set_exit_price_override(symbol, float(take_profit))
                self._close(symbol, f"TP @{float(take_profit):.4f}")
                return "BUY"

        # Time-based exit (confidence-driven hold duration)
        max_hold_hours = hold_hours_from_score(confidence)
        if (datetime.utcnow() - opened_at) > timedelta(hours=max_hold_hours):
            self._close(symbol, f"time limit {max_hold_hours}h")
            return "SELL" if side == "BUY" else "BUY"

        # RSI exhaustion
        try:
            rsi = RSIIndicator(df["close"], window=14).rsi()
            curr_rsi = float(rsi.iloc[-1])
            prev_rsi = float(rsi.iloc[-2])
            if side == "BUY"  and curr_rsi > float(self.config.get("exit_rules", {}).get("rsi_overbought_exit", 72)) and curr_rsi < prev_rsi:
                self._close(symbol, f"RSI peak {curr_rsi:.1f}")
                return "SELL"
            if side == "SELL" and curr_rsi < float(self.config.get("exit_rules", {}).get("rsi_oversold_exit", 28))  and curr_rsi > prev_rsi:
                self._close(symbol, f"RSI trough {curr_rsi:.1f}")
                return "BUY"
        except Exception:
            pass

        return None


# =============================================================================
# Shared indicator computation
# =============================================================================

class _Indicators:
    __slots__ = [
        "ema20", "ema50", "ema200",
        "rsi", "prev_rsi",
        "bb_lower", "bb_upper", "bb_mid",
        "atr", "atr_avg",
        "volume_avg",
        "recent_high_20", "recent_low_20",
        "curr_close", "curr_vol",
        "trend_up_4h",
    ]

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def _compute_indicators(df: pd.DataFrame, df_trend: pd.DataFrame) -> Optional["_Indicators"]:
    try:
        close  = df["close"]
        high   = df["high"]
        low    = df["low"]
        volume = df["volume"]

        ema20  = EMAIndicator(close, window=20).ema_indicator()
        ema50  = EMAIndicator(close, window=50).ema_indicator()
        ema200 = EMAIndicator(close, window=200).ema_indicator() if len(df) >= 200 else ema50  # fallback

        rsi_series = RSIIndicator(close, window=14).rsi()

        bb       = BollingerBands(close, window=20, window_dev=2)
        atr      = AverageTrueRange(high, low, close, window=14).average_true_range()
        atr_avg  = atr.rolling(20).mean()
        vol_avg  = volume.rolling(20).mean()

        curr = df.iloc[-1]

        critical = [ema20.iloc[-1], ema50.iloc[-1], rsi_series.iloc[-1], atr.iloc[-1]]
        if any(pd.isna(v) for v in critical):
            return None

        # 4h trend (use df if df_trend same as df)
        ema200_4h   = EMAIndicator(df_trend["close"], window=min(200, len(df_trend) - 1)).ema_indicator()
        trend_up_4h = float(df_trend["close"].iloc[-1]) > float(ema200_4h.iloc[-1])

        return _Indicators(
            ema20          = float(ema20.iloc[-1]),
            ema50          = float(ema50.iloc[-1]),
            ema200         = float(ema200.iloc[-1]),
            rsi            = float(rsi_series.iloc[-1]),
            prev_rsi       = float(rsi_series.iloc[-2]),
            bb_lower       = float(bb.bollinger_lband().iloc[-1]),
            bb_upper       = float(bb.bollinger_hband().iloc[-1]),
            bb_mid         = float(bb.bollinger_mavg().iloc[-1]),
            atr            = float(atr.iloc[-1]),
            atr_avg        = float(atr_avg.iloc[-1]) if not pd.isna(atr_avg.iloc[-1]) else float(atr.iloc[-1]),
            volume_avg     = float(vol_avg.iloc[-1]) if not pd.isna(vol_avg.iloc[-1]) else float(volume.iloc[-1]),
            recent_high_20 = float(high.iloc[-21:-1].max()) if len(high) > 21 else float(high.max()),
            recent_low_20  = float(low.iloc[-21:-1].min())  if len(low)  > 21 else float(low.min()),
            curr_close     = float(curr["close"]),
            curr_vol       = float(curr["volume"]),
            trend_up_4h    = trend_up_4h,
        )
    except Exception as exc:
        logger.error("_compute_indicators error: %s", exc, exc_info=True)
        return None


# =============================================================================
# Sub-strategy: BREAKOUT (v5 — relaxed thresholds)
# =============================================================================

def detect_breakout(df: pd.DataFrame, ind: "_Indicators") -> Optional[str]:
    """
    v5: Relaxed thresholds.
    vol_ratio >= 1.05 (was 1.20) — accepts moderate volume spikes.
    atr_ratio >= 0.50 (was 0.80) — fires even in compressed ATR.
    """
    price     = ind.curr_close
    vol_ratio = ind.curr_vol / max(ind.volume_avg, 1e-8)
    atr_ratio = ind.atr / max(ind.atr_avg, 1e-8)

    if vol_ratio < 1.05 or atr_ratio < 0.50:
        return None

    prev2      = df.iloc[-3:-1]
    prev2_high = float(prev2["high"].max())
    prev2_low  = float(prev2["low"].min())

    if price > ind.recent_high_20 and price > prev2_high:
        return "BUY"
    if price < ind.recent_low_20  and price < prev2_low:
        return "SELL"
    return None


# =============================================================================
# Sub-strategy: PULLBACK (unchanged from v4)
# =============================================================================

def detect_pullback(df: pd.DataFrame, ind: "_Indicators") -> Optional[str]:
    price = ind.curr_close
    rsi   = ind.rsi
    ema20 = ind.ema20
    ema50 = ind.ema50
    if price <= 0 or ema20 <= 0 or ema50 <= 0:
        return None

    curr_candle      = df.iloc[-1]
    is_bullish_candle = float(curr_candle["close"]) > float(curr_candle["open"])
    is_bearish_candle = float(curr_candle["close"]) < float(curr_candle["open"])

    near_ema20   = abs(price - ema20) / ema20 <= 0.015
    near_ema50   = abs(price - ema50) / ema50 <= 0.015
    near_support = near_ema20 or near_ema50

    if not near_support:
        return None

    rsi_reset = 40 <= rsi <= 62
    if not rsi_reset:
        return None

    if ind.trend_up_4h and price > ind.ema200 and price > ema20 and is_bullish_candle:
        return "BUY"
    if not ind.trend_up_4h and price < ind.ema200 and price < ema20 and is_bearish_candle:
        return "SELL"
    return None


# =============================================================================
# Sub-strategy: MOMENTUM (NEW in v5)
# =============================================================================

def detect_momentum(df: pd.DataFrame, ind: "_Indicators") -> Optional[str]:
    """
    Fires whenever RSI crosses the 50 midline with price confirmation.
    This is the most frequent signal — 2-5 times per symbol per day.

    BUY:  RSI crossed 50 upward AND price above EMA20 (short-term uptrend)
    SELL: RSI crossed 50 downward AND price below EMA20
    """
    curr_rsi = ind.rsi
    prev_rsi = ind.prev_rsi
    price    = ind.curr_close
    ema20    = ind.ema20

    if ema20 <= 0:
        return None

    # RSI just crossed above 50, price confirming
    if prev_rsi < 50 <= curr_rsi and price > ema20:
        return "BUY"

    # RSI just crossed below 50, price confirming
    if prev_rsi > 50 >= curr_rsi and price < ema20:
        return "SELL"

    return None


# =============================================================================
# Sub-strategy: SCALP (v5 — relaxed ATR threshold, enabled by default)
# =============================================================================

def detect_scalp(df: pd.DataFrame, ind: "_Indicators") -> Optional[str]:
    """
    v5: ATR threshold relaxed from 0.85× to 1.10× (fires in more conditions).
    Targets small range breakouts during low-volatility periods.
    """
    # Only in relatively quiet ATR environments (not during high volatility)
    if ind.atr_avg <= 0 or ind.atr / ind.atr_avg > 1.10:
        return None

    high_5 = float(df["high"].iloc[-6:-1].max())
    low_5  = float(df["low"].iloc[-6:-1].min())
    price  = ind.curr_close

    candle_range = high_5 - low_5
    if candle_range <= 0:
        return None

    if price > high_5:
        return "BUY"
    if price < low_5:
        return "SELL"
    return None