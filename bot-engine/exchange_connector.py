import ccxt
import ccxt.async_support as ccxt_async
import pandas as pd
import logging
from typing import Optional, Dict, List

logger = logging.getLogger(__name__)

# Maps our exchange names to CCXT ids
EXCHANGE_MAP = {
    "bingx":       "bingx",
    "coindcx":     "coindcx",
    "coinswitch":  "coinswitch",
    "delta":       "delta",
    "zerodha":     "zerodha",   # via custom plugin
    "dhan":        "dhan",
    "upstox":      "upstox",
    "fyers":       "fyers",
    "angelone":    "angelone",
    "binance":     "binance",
    "kraken":      "kraken",
    "interactive": "ibkr",
}

class ExchangeConnector:
    def __init__(self, exchange_name: str, api_key: str, api_secret: str,
                 extra: Optional[Dict] = None):
        self.exchange_name = exchange_name
        self.extra         = extra or {}

        ccxt_id = EXCHANGE_MAP.get(exchange_name, exchange_name)
        ExClass = getattr(ccxt_async, ccxt_id, None)

        if not ExClass:
            raise ValueError(f"Exchange '{exchange_name}' not supported by CCXT")

        self.exchange = ExClass({
            "apiKey":    api_key,
            "secret":    api_secret,
            "enableRateLimit": True,
            **self.extra,
        })

    async def fetch_ohlcv(self, symbol: str, timeframe: str = "15m",
                          limit: int = 100) -> pd.DataFrame:
        """Fetch OHLCV candles and return as DataFrame."""
        raw = await self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
        df  = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        df.set_index("timestamp", inplace=True)
        return df.astype(float)

    async def get_balance(self, currency: str = "USDT") -> float:
        balance = await self.exchange.fetch_balance()
        return float(balance.get("free", {}).get(currency, 0))

    async def place_order(self, symbol: str, side: str, quantity: float,
                          order_type: str = "market",
                          price: Optional[float] = None) -> Dict:
        """Place a trade order. Returns exchange order dict."""
        try:
            if order_type == "market":
                order = await self.exchange.create_order(symbol, "market", side, quantity)
            else:
                order = await self.exchange.create_order(symbol, "limit", side, quantity, price)
            logger.info(f"Order placed: {side} {quantity} {symbol} → id={order['id']}")
            return order
        except Exception as e:
            logger.error(f"Order failed: {e}")
            raise

    async def fetch_open_orders(self, symbol: Optional[str] = None) -> List[Dict]:
        return await self.exchange.fetch_open_orders(symbol)

    async def cancel_order(self, order_id: str, symbol: str) -> Dict:
        return await self.exchange.cancel_order(order_id, symbol)

    async def fetch_ticker(self, symbol: str) -> Dict:
        return await self.exchange.fetch_ticker(symbol)

    async def close(self):
        await self.exchange.close()