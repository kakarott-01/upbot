/**
 * lib/encryption.ts  — v2
 * ========================
 * FIX: Replaced CryptoJS password-mode AES (MD5/EVP key derivation) with
 *      proper AES-256-GCM using Node.js crypto + scrypt key derivation.
 *
 * Format: "v2:<base64(iv[12] + authTag[16] + ciphertext)>"
 *
 * BACKWARD COMPAT: Any existing ciphertext WITHOUT the "v2:" prefix is
 * decrypted using the legacy CryptoJS path so existing DB records still work.
 * New writes always use v2. There is no need to migrate existing records —
 * they will simply decrypt via the legacy path until they are re-written.
 *
 * NOTE FOR PYTHON BOT ENGINE (bot-engine/db.py):
 *   The v2 key is derived as:  scrypt(ENCRYPTION_KEY, 'upbot-salt-v2', 32)
 *   with N=16384, r=8, p=1  (Node.js crypto.scryptSync defaults).
 *   The Python side must use hashlib.scrypt with the same params.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto'
import CryptoJS from 'crypto-js'

const ALGORITHM  = 'aes-256-gcm'
const IV_LEN     = 12  // 96-bit IV — recommended for GCM
const TAG_LEN    = 16  // 128-bit auth tag
const V2_PREFIX  = 'v2:'

// ── Key derivation (deterministic, same key every time) ───────────────────────
// scrypt is used instead of PBKDF2 because it is memory-hard and more resistant
// to GPU-accelerated brute force.  Parameters match Python hashlib.scrypt defaults.
function deriveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY not set in environment')
  return scryptSync(raw, 'upbot-salt-v2', 32)   // N=16384, r=8, p=1 (defaults)
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Encrypt plaintext with AES-256-GCM.  Returns "v2:<base64>" string. */
export function encrypt(plaintext: string): string {
  const key    = deriveKey()
  const iv     = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()   // 16 bytes

  // Pack: iv(12) ‖ tag(16) ‖ ciphertext
  const packed = Buffer.concat([iv, tag, encrypted])
  return V2_PREFIX + packed.toString('base64')
}

/**
 * Decrypt a ciphertext string.
 * Supports both v2 (AES-256-GCM) and legacy (CryptoJS/MD5) formats.
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) throw new Error('decrypt: empty ciphertext')

  if (ciphertext.startsWith(V2_PREFIX)) {
    return _decryptV2(ciphertext.slice(V2_PREFIX.length))
  }
  // Fall back to legacy CryptoJS path for pre-existing DB records
  return _decryptLegacy(ciphertext)
}

export function encryptJSON(obj: Record<string, string>): string {
  return encrypt(JSON.stringify(obj))
}

export function decryptJSON(ciphertext: string): Record<string, string> {
  return JSON.parse(decrypt(ciphertext))
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _decryptV2(b64: string): string {
  const key    = deriveKey()
  const packed = Buffer.from(b64, 'base64')

  if (packed.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('decrypt v2: ciphertext too short')
  }

  const iv         = packed.subarray(0, IV_LEN)
  const tag        = packed.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = packed.subarray(IV_LEN + TAG_LEN)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error('decrypt v2: authentication failed — data may be tampered')
  }
}

function _decryptLegacy(ciphertext: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY not set')
  const bytes = CryptoJS.AES.decrypt(ciphertext, key)
  const result = bytes.toString(CryptoJS.enc.Utf8)
  if (!result) throw new Error('decrypt legacy: decryption produced empty string')
  return result
}