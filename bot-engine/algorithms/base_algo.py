import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Optional, Dict
from exchange_connector import ExchangeConnector
from risk_manager import RiskManager

logger = logging.getLogger(__name__)

class BaseAlgo(ABC):
    """
    All trading algorithms inherit this.
    Override: load_config(), generate_signal(), get_symbols()
    """

    def __init__(self, connector: ExchangeConnector, risk_mgr: RiskManager,
                 db, user_id: str):
        self.connector = connector
        self.risk      = risk_mgr
        self.db        = db
        self.user_id   = user_id
        self.config    = self.load_config()
        self.name      = self.config.get("algo_name", self.__class__.__name__)
        logger.info(f"[{self.name}] Initialized for user={user_id}")

    def load_config(self) -> Dict:
        """Load config from JSON file. Reloads on every cycle — edit file to update."""
        config_path = os.path.join(
            os.path.dirname(__file__),
            "algorithms", "configs",
            self.config_filename()
        )
        if not os.path.exists(config_path):
            logger.warning(f"Config not found: {config_path}, using defaults")
            return self.default_config()
        with open(config_path, "r") as f:
            return json.load(f)

    @abstractmethod
    def config_filename(self) -> str:
        """Return the JSON config filename for this algo."""
        ...

    @abstractmethod
    def default_config(self) -> Dict:
        """Fallback config if JSON file missing."""
        ...

    @abstractmethod
    def get_symbols(self) -> list[str]:
        """Return list of symbols to trade."""
        ...

    @abstractmethod
    async def generate_signal(self, symbol: str) -> Optional[str]:
        """Return 'buy', 'sell', or None (hold). Core logic lives here."""
        ...

    async def run_cycle(self):
        """
        Main loop called by scheduler every N seconds.
        Reloads config each cycle so JSON edits take effect immediately.
        """
        self.config = self.load_config()  # hot-reload config

        if not self.config.get("enabled", True):
            logger.debug(f"[{self.name}] Disabled via config")
            return

        symbols = self.get_symbols()
        balance = await self.connector.get_balance(self.config.get("quote_currency", "USDT"))

        for symbol in symbols:
            try:
                can_trade, reason = self.risk.can_trade(balance)

                if not can_trade:
                    logger.info(f"[{self.name}] Skipping {symbol}: {reason}")
                    continue

                signal = await self.generate_signal(symbol)
                if not signal:
                    continue

                logger.info(f"[{self.name}] Signal: {signal.upper()} {symbol}")

                # Save signal to DB for dashboard
                await self.db.save_signal(self.user_id, self.name,
                                          self.market_type, symbol, signal)

                paper_mode = self.config.get("paper_mode", True)

                if paper_mode:
                    ticker   = await self.connector.fetch_ticker(symbol)
                    price    = ticker["last"]
                    quantity = self.risk.calculate_position_size(balance, price)
                    await self.db.save_paper_trade(
                        self.user_id, symbol, signal, quantity,
                        price, self.name, self.market_type
                    )
                    logger.info(f"[{self.name}] PAPER {signal} {quantity} {symbol} @ {price}")
                else:
                    await self._execute_live_trade(symbol, signal, balance)

            except Exception as e:
                logger.error(f"[{self.name}] Error on {symbol}: {e}", exc_info=True)
                await self.db.update_bot_status(self.user_id, "error", [], str(e))

    async def _execute_live_trade(self, symbol: str, signal: str, balance: float):
        ticker   = await self.connector.fetch_ticker(symbol)
        price    = ticker["last"]
        quantity = self.risk.calculate_position_size(balance, price)
        sl       = self.risk.calculate_stop_loss(price, signal)
        tp       = self.risk.calculate_take_profit(price, signal)

        order = await self.connector.place_order(symbol, signal, quantity)

        self.risk.record_trade_opened()
        await self.db.save_live_trade(
            self.user_id, symbol, signal, quantity, price,
            sl, tp, order["id"], self.name, self.market_type
        )

    @property
    @abstractmethod
    def market_type(self) -> str:
        ...