import os
import json
import logging
from typing import Optional, Dict, List
from datetime import datetime
import asyncpg
from dotenv import load_dotenv

import base64
import hashlib
from Crypto.Cipher import AES

load_dotenv()
logger = logging.getLogger(__name__)


# ── CryptoJS-compatible AES decryption ────────────────────────────────────────

def _evp_bytes_to_key(password: bytes, salt: bytes, key_len=32, iv_len=16):
    d = b""
    result = b""
    while len(result) < (key_len + iv_len):
        d = hashlib.md5(d + password + salt).digest()
        result += d
    return result[:key_len], result[key_len:key_len + iv_len]


def decrypt_field(ciphertext: str) -> Optional[str]:
    try:
        if not ciphertext:
            return None

        password = os.getenv("ENCRYPTION_KEY")
        if not password:
            raise Exception("ENCRYPTION_KEY not set")

        raw = base64.b64decode(ciphertext)

        if raw[:8] != b"Salted__":
            return ciphertext  # plain text fallback (unencrypted legacy value)

        salt      = raw[8:16]
        encrypted = raw[16:]

        key, iv = _evp_bytes_to_key(password.encode(), salt)

        cipher    = AES.new(key, AES.MODE_CBC, iv)
        decrypted = cipher.decrypt(encrypted)

        pad_len   = decrypted[-1]
        decrypted = decrypted[:-pad_len]

        return decrypted.decode("utf-8")

    except Exception as e:
        logger.error(f"❌ Decryption failed: {e}")
        return None


# ── Database ──────────────────────────────────────────────────────────────────

class Database:
    def __init__(self):
        self.url = os.getenv("DATABASE_URL")
        if not self.url:
            raise RuntimeError("DATABASE_URL environment variable is not set")
        self._pool: Optional[asyncpg.Pool] = None

    async def _get_pool(self) -> asyncpg.Pool:
        if not self._pool:
            self._pool = await asyncpg.create_pool(
                self.url,
                min_size=1,
                max_size=5,
            )
        return self._pool

    # ─────────────────────────────────────────────────────────────────────────

    async def get_exchange_apis(self, user_id: str) -> Dict[str, Dict]:
        pool = await self._get_pool()

        rows = await pool.fetch(
            """SELECT market_type, exchange_name, api_key_enc, api_secret_enc, extra_fields_enc
               FROM exchange_apis
               WHERE user_id = $1 AND is_active = true""",
            user_id,
        )

        result = {}

        for row in rows:
            try:
                api_key    = decrypt_field(row["api_key_enc"])
                api_secret = decrypt_field(row["api_secret_enc"])

                if not api_key or not api_secret:
                    logger.error(f"❌ Failed to decrypt API keys for market={row['market_type']}")
                    continue

                # Decrypt extra fields (e.g. TOTP secret for Angel One)
                extra = {}
                if row["extra_fields_enc"]:
                    try:
                        extra_raw = decrypt_field(row["extra_fields_enc"])
                        if extra_raw:
                            extra = json.loads(extra_raw)
                    except Exception as e:
                        logger.warning(f"⚠️  Could not parse extra fields: {e}")

                logger.info(f"🔑 API keys loaded for market={row['market_type']} exchange={row['exchange_name']}")

                result[row["market_type"]] = {
                    "exchange_name": row["exchange_name"],
                    "api_key":       api_key,
                    "api_secret":    api_secret,
                    "extra":         extra,
                }

            except Exception as e:
                logger.error(f"❌ Failed to load API for market={row['market_type']}: {e}")

        return result

    # ─────────────────────────────────────────────────────────────────────────

    async def get_risk_settings(self, user_id: str) -> Dict:
        pool = await self._get_pool()
        row  = await pool.fetchrow(
            "SELECT * FROM risk_settings WHERE user_id = $1", user_id
        )
        return dict(row) if row else {}

    # ─────────────────────────────────────────────────────────────────────────

    async def save_signal(
        self,
        user_id: str,
        algo_name: str,
        market_type: str,
        symbol: str,
        signal: str,
        indicators: Dict = None,
    ):
        pool = await self._get_pool()
        await pool.execute(
            """INSERT INTO algo_signals
               (user_id, market_type, symbol, signal, algo_name, indicators_snapshot, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            user_id,
            market_type,
            symbol,
            signal.lower(),   # schema uses lowercase enum values
            algo_name,
            json.dumps(indicators or {}),
            datetime.utcnow(),
        )

    # ─────────────────────────────────────────────────────────────────────────

    async def save_paper_trade(
        self,
        user_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        algo_name: str,
        market_type: str,
    ):
        pool = await self._get_pool()
        await pool.execute(
            """INSERT INTO trades
               (user_id, exchange_name, market_type, symbol, side, quantity,
                entry_price, status, algo_used, is_paper, opened_at)
               VALUES ($1, 'paper', $2, $3, $4, $5, $6, 'open', $7, true, $8)""",
            user_id,
            market_type,
            symbol,
            side.lower(),
            str(quantity),
            str(price),
            algo_name,
            datetime.utcnow(),
        )
        logger.info(f"📝 Paper trade saved: {side} {quantity} {symbol} @ {price}")

    # ─────────────────────────────────────────────────────────────────────────

    async def save_live_trade(
        self,
        user_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        stop_loss: float,
        take_profit: float,
        order_id: str,
        algo_name: str,
        market_type: str,
    ):
        pool = await self._get_pool()
        await pool.execute(
            """INSERT INTO trades
               (user_id, exchange_name, market_type, symbol, side, quantity,
                entry_price, stop_loss, take_profit, status, algo_used,
                is_paper, exchange_order_id, opened_at)
               VALUES ($1, 'live', $2, $3, $4, $5, $6, $7, $8, 'open', $9, false, $10, $11)""",
            user_id,
            market_type,
            symbol,
            side.lower(),
            str(quantity),
            str(price),
            str(stop_loss),
            str(take_profit),
            algo_name,
            order_id,
            datetime.utcnow(),
        )
        logger.info(f"📝 Live trade saved: {side} {quantity} {symbol} @ {price}")

    # ─────────────────────────────────────────────────────────────────────────

    async def update_bot_status(
        self,
        user_id: str,
        status: str,
        markets: List[str],
        error: str = None,
    ):
        pool = await self._get_pool()
        await pool.execute(
            """INSERT INTO bot_statuses (user_id, status, active_markets, updated_at)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (user_id) DO UPDATE
               SET status = $2,
                   active_markets = $3,
                   updated_at = $4,
                   error_message = $5""",
            user_id,
            status,
            json.dumps(markets),
            datetime.utcnow(),
            error,
        )