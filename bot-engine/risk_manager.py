import logging
from typing import Optional, Dict
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class RiskConfig:
    max_position_pct:  float = 2.0    # max % of balance per trade
    stop_loss_pct:     float = 1.5    # stop loss %
    take_profit_pct:   float = 3.0    # take profit %
    max_daily_loss_pct:float = 5.0    # halt bot if daily loss > this %
    max_open_trades:   int   = 3      # max simultaneous positions
    cooldown_seconds:  int   = 300    # wait after a loss before next trade
    trailing_stop:     bool  = False

class RiskManager:
    def __init__(self, config: Optional[Dict] = None):
        cfg = config or {}
        self.cfg = RiskConfig(
            max_position_pct   = float(cfg.get("max_position_pct",   2.0)),
            stop_loss_pct      = float(cfg.get("stop_loss_pct",      1.5)),
            take_profit_pct    = float(cfg.get("take_profit_pct",    3.0)),
            max_daily_loss_pct = float(cfg.get("max_daily_loss_pct", 5.0)),
            max_open_trades    = int(cfg.get("max_open_trades",      3)),
            cooldown_seconds   = int(cfg.get("cooldown_seconds",     300)),
            trailing_stop      = bool(cfg.get("trailing_stop",       False)),
        )
        self.daily_loss       = 0.0
        self.open_trade_count = 0
        self.last_loss_time   = None

    def calculate_position_size(self, balance: float, entry_price: float) -> float:
        """Calculate how many units to buy given balance and risk limits."""
        risk_amount = balance * (self.cfg.max_position_pct / 100)
        units       = risk_amount / entry_price
        return round(units, 8)

    def calculate_stop_loss(self, entry_price: float, side: str) -> float:
        """Calculate stop loss price."""
        factor = 1 - self.cfg.stop_loss_pct / 100 if side == "buy" \
            else 1 + self.cfg.stop_loss_pct / 100
        return round(entry_price * factor, 8)

    def calculate_take_profit(self, entry_price: float, side: str) -> float:
        """Calculate take profit price."""
        factor = 1 + self.cfg.take_profit_pct / 100 if side == "buy" \
            else 1 - self.cfg.take_profit_pct / 100
        return round(entry_price * factor, 8)

    def can_trade(self, balance: float) -> tuple[bool, str]:
        """Returns (can_trade, reason). Checks all risk guards."""
        import time

        # Max open trades
        if self.open_trade_count >= self.cfg.max_open_trades:
            return False, f"Max open trades ({self.cfg.max_open_trades}) reached"

        # Daily loss limit
        daily_loss_pct = abs(self.daily_loss / balance * 100) if balance > 0 else 0
        if daily_loss_pct >= self.cfg.max_daily_loss_pct:
            return False, f"Daily loss limit ({self.cfg.max_daily_loss_pct}%) reached"

        # Cooldown after loss
        if self.last_loss_time:
            elapsed = time.time() - self.last_loss_time
            if elapsed < self.cfg.cooldown_seconds:
                remaining = int(self.cfg.cooldown_seconds - elapsed)
                return False, f"Cooldown active — {remaining}s remaining"

        return True, "ok"

    def record_trade_opened(self):
        self.open_trade_count = min(self.open_trade_count + 1, self.cfg.max_open_trades)

    def record_trade_closed(self, pnl: float):
        import time
        self.open_trade_count = max(0, self.open_trade_count - 1)
        self.daily_loss += min(0, pnl)  # only track losses
        if pnl < 0:
            self.last_loss_time = time.time()

    def reset_daily(self):
        """Call this at the start of each trading day."""
        self.daily_loss = 0.0
        logger.info("Daily loss counter reset")