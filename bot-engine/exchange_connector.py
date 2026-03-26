import ccxt.async_support as ccxt
import pandas as pd
import logging
from typing import Optional, Dict, List

logger = logging.getLogger(__name__)

# ccxt exchange IDs for each exchange name used in the UI
EXCHANGE_MAP = {
    "bingx":       "bingx",
    "coindcx":     "coindcx",
    "coinswitch":  "coinswitch",
    "delta":       "delta",
    "deltaexch":   "delta",
    "binance":     "binance",
    "kraken":      "kraken",
    "ibkr":        "ibkr",
    "interactive": "ibkr",
    # Indian brokers supported by ccxt (limited):
    # Zerodha, Dhan, Upstox, Fyers use proprietary SDKs —
    # map them to a passthrough so the error is clear.
}

# Which markets trade futures/swaps vs spot
FUTURES_MARKETS = {"crypto", "commodities", "global"}
SPOT_MARKETS    = {"indian"}


class ExchangeConnector:
    def __init__(
        self,
        exchange_name: str,
        api_key: str,
        api_secret: str,
        extra: Optional[Dict] = None,
        market_type: str = "crypto",
    ):
        self.exchange_name = exchange_name.lower()
        self.extra         = extra or {}
        self.market_type   = market_type

        if not api_key or not api_secret:
            raise ValueError("❌ API keys missing in ExchangeConnector")

        ccxt_id  = EXCHANGE_MAP.get(self.exchange_name, self.exchange_name)
        ExClass  = getattr(ccxt, ccxt_id, None)

        if not ExClass:
            raise ValueError(
                f"Exchange '{exchange_name}' (ccxt id: '{ccxt_id}') is not supported by ccxt. "
                f"For Indian brokers (Zerodha, Dhan, Upstox, Fyers) you need their proprietary SDK."
            )

        # ── Set correct trading mode based on market type ──────────────────
        # Spot for Indian equities; swap/futures for crypto/commodities/global
        if market_type in FUTURES_MARKETS:
            options = {"defaultType": "swap"}
        else:
            options = {"defaultType": "spot"}

        logger.info(f"🔌 Initializing {ccxt_id} in {options['defaultType']} mode for market={market_type}")

        self.exchange = ExClass({
            "apiKey":          api_key,
            "secret":          api_secret,
            "enableRateLimit": True,
            "options":         options,
            **self.extra,
        })

    # ─────────────────────────────────────────────────────────────────────────

    async def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str = "15m",
        limit: int = 100,
    ) -> pd.DataFrame:
        try:
            raw = await self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)

            if not raw:
                raise ValueError(f"Empty OHLCV response for {symbol}")

            df = pd.DataFrame(
                raw,
                columns=["timestamp", "open", "high", "low", "close", "volume"],
            )
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
            df.set_index("timestamp", inplace=True)
            return df.astype(float)

        except Exception as e:
            logger.error(f"❌ OHLCV fetch failed for {symbol}: {e}", exc_info=True)
            raise

    # ─────────────────────────────────────────────────────────────────────────

    async def get_balance(self, currency: str = "USDT") -> float:
        try:
            balance = await self.exchange.fetch_balance()
            value   = float(balance.get("free", {}).get(currency, 0))
            logger.info(f"💰 Balance {currency}: {value}")
            return value
        except Exception as e:
            logger.error(f"❌ Balance fetch failed: {e}", exc_info=True)
            raise

    # ─────────────────────────────────────────────────────────────────────────

    async def fetch_ticker(self, symbol: str) -> Dict:
        try:
            return await self.exchange.fetch_ticker(symbol)
        except Exception as e:
            logger.error(f"❌ Ticker fetch failed for {symbol}: {e}", exc_info=True)
            raise

    # ─────────────────────────────────────────────────────────────────────────

    async def place_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        order_type: str = "market",
        price: Optional[float] = None,
    ) -> Dict:
        try:
            side = side.lower()
            logger.info(f"📤 Placing {order_type} {side} order: {quantity} {symbol}")

            if order_type == "market":
                order = await self.exchange.create_order(symbol, "market", side, quantity)
            else:
                order = await self.exchange.create_order(symbol, "limit", side, quantity, price)

            logger.info(f"✅ Order placed: id={order.get('id')}")
            return order

        except Exception as e:
            logger.error(f"❌ Order failed: {e}", exc_info=True)
            raise

    # ─────────────────────────────────────────────────────────────────────────

    async def fetch_open_orders(self, symbol: Optional[str] = None) -> List[Dict]:
        try:
            return await self.exchange.fetch_open_orders(symbol)
        except Exception as e:
            logger.error(f"❌ Fetch open orders failed: {e}", exc_info=True)
            return []

    # ─────────────────────────────────────────────────────────────────────────

    async def cancel_order(self, order_id: str, symbol: str) -> Dict:
        try:
            return await self.exchange.cancel_order(order_id, symbol)
        except Exception as e:
            logger.error(f"❌ Cancel order failed: {e}", exc_info=True)
            raise

    # ─────────────────────────────────────────────────────────────────────────

    async def close(self):
        try:
            await self.exchange.close()
        except Exception:
            pass