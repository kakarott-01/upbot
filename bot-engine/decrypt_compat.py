"""
bot-engine/decrypt_compat.py  — NEW standalone helper
=======================================================
Provides the v2 decryption logic separately so you can test it
independently of the full db.py, and so the scrypt parameters are
documented in one clear place.

IMPORTANT — Python package required:
  pip install pycryptodome  (already in requirements.txt as pycryptodome==3.19.0)

IMPORTANT — scrypt parameters MUST exactly match the Node.js side:
  Node.js: crypto.scryptSync(password, 'upbot-salt-v2', 32)
  Defaults: N=16384, r=8, p=1, dklen=32

  Python: hashlib.scrypt(password, salt=b'upbot-salt-v2', n=16384, r=8, p=1, dklen=32)

Usage:
  from decrypt_compat import decrypt_field
  plain = decrypt_field(row["api_key_enc"])
"""

import os
import base64
import hashlib
from typing import Optional
from Crypto.Cipher import AES


# ─── V2: AES-256-GCM with scrypt key derivation ────────────────────────────────

def _derive_key_v2() -> bytes:
    password = os.getenv("ENCRYPTION_KEY")
    if not password:
        raise RuntimeError("ENCRYPTION_KEY not set")
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=b"upbot-salt-v2",
        n=16384,     # MUST match Node.js default
        r=8,         # MUST match Node.js default
        p=1,         # MUST match Node.js default
        dklen=32,
    )


def _decrypt_v2(b64: str) -> Optional[str]:
    """
    Decrypt AES-256-GCM ciphertext produced by Node.js:
      encrypt(plaintext) → "v2:" + base64( iv[12] ‖ tag[16] ‖ ciphertext )
    """
    try:
        key    = _derive_key_v2()
        packed = base64.b64decode(b64)

        if len(packed) < 12 + 16 + 1:
            raise ValueError(f"v2 ciphertext too short: {len(packed)} bytes")

        iv         = packed[:12]
        tag        = packed[12:28]
        ciphertext = packed[28:]

        cipher    = AES.new(key, AES.MODE_GCM, nonce=iv)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        return plaintext.decode("utf-8")
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"V2 decryption failed: {e}")
        return None


# ─── Legacy: CryptoJS AES-CBC with MD5/EVP key derivation ─────────────────────

def _evp_bytes_to_key(password: bytes, salt: bytes, key_len: int = 32, iv_len: int = 16):
    d, result = b"", b""
    while len(result) < key_len + iv_len:
        d = hashlib.md5(d + password + salt).digest()
        result += d
    return result[:key_len], result[key_len:key_len + iv_len]


def _decrypt_legacy(ciphertext: str) -> Optional[str]:
    try:
        password = os.getenv("ENCRYPTION_KEY")
        if not password:
            raise RuntimeError("ENCRYPTION_KEY not set")
        raw = base64.b64decode(ciphertext)
        if raw[:8] != b"Salted__":
            return ciphertext   # Not a CryptoJS ciphertext — return as-is
        salt      = raw[8:16]
        encrypted = raw[16:]
        key, iv   = _evp_bytes_to_key(password.encode(), salt)
        cipher    = AES.new(key, AES.MODE_CBC, iv)
        decrypted = cipher.decrypt(encrypted)
        pad_len   = decrypted[-1]
        return decrypted[:-pad_len].decode("utf-8")
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Legacy decryption failed: {e}")
        return None


# ─── Public API ────────────────────────────────────────────────────────────────

def decrypt_field(ciphertext: str) -> Optional[str]:
    """
    Decrypt a DB field.  Supports:
      - "v2:<base64>"  → AES-256-GCM (new, secure)
      - "<base64>"     → CryptoJS AES-CBC (legacy, still works for existing records)
    """
    if not ciphertext:
        return None
    if ciphertext.startswith("v2:"):
        return _decrypt_v2(ciphertext[3:])
    return _decrypt_legacy(ciphertext)


# ─── Self-test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    # Set a test key (match whatever is in your .env)
    os.environ.setdefault("ENCRYPTION_KEY", "test-key-must-be-32-bytes-minimum!!")

    # Simulate a v2 ciphertext (normally produced by Node.js encrypt())
    # To test end-to-end: run Node.js encrypt("hello") and paste the result here
    test_cases = [
        ("legacy test", None),    # set to a real legacy ciphertext from your DB
        ("v2 test",     None),    # set to a real v2 ciphertext after deploying Node.js fix
    ]

    for label, ct in test_cases:
        if ct is None:
            print(f"[{label}] ⚠️  No test ciphertext provided — skipping")
            continue
        result = decrypt_field(ct)
        print(f"[{label}] → {result!r}")