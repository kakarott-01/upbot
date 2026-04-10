/**
 * lib/signed-cookie.ts  — NEW
 * ============================
 * FIX: Replaces the unsigned JSON session cookie (vulnerable to forgery via
 *      XSS / cookie manipulation) with an HMAC-SHA256 signed value.
 *
 * Cookie format: "<base64url(payload)>.<base64url(HMAC-SHA256(payload, secret))>"
 *
 * Legacy unsigned cookies are intentionally rejected.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY
if (!SECRET) {
  throw new Error('NEXTAUTH_SECRET or ENCRYPTION_KEY must be set for signed cookies')
}

// TTL for signed session payloads (ms). Default 7 days to limit stale cookie window.
const SIGNED_COOKIE_TTL_MS = Number(process.env.SIGNED_COOKIE_TTL_MS) || 7 * 24 * 60 * 60 * 1000

export interface SessionPayload {
  id:    string
  email: string
  name:  string
  hasAccess?: boolean
}

// ── Sign ──────────────────────────────────────────────────────────────────────

/**
 * Produce a signed cookie value for the given session payload.
 * Store this as the user_session cookie (httpOnly + secure + sameSite=lax).
 */
export function signSession(payload: SessionPayload): string {
  const wrapped = { ...payload, iat: Date.now() }
  const data = Buffer.from(JSON.stringify(wrapped)).toString('base64url')
  const sig  = _sign(data)
  return `${data}.${sig}`
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verify and decode a signed session cookie.
 * Returns the payload on success, null on any failure (bad sig, malformed, etc.).
 *
 * Legacy unsigned cookies are rejected.
 */
export function verifySession(cookie: string | undefined): SessionPayload | null {
  if (!cookie) return null

  const dotIdx = cookie.lastIndexOf('.')
  if (dotIdx <= 0) return null

  const data = cookie.slice(0, dotIdx)
  const sig  = cookie.slice(dotIdx + 1)
  const parsed = _verifySignedParts(data, sig)
  if (!parsed) return null

  // Expiry check (defence in depth to cookie maxAge)
  const iat = typeof parsed.iat === 'number' ? parsed.iat : null
  if (!iat || Date.now() - iat > SIGNED_COOKIE_TTL_MS) return null

  // Remove iat and return SessionPayload
  const { iat: _ignored, ...rest } = parsed as any
  return rest as SessionPayload
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _sign(data: string): string {
  return createHmac('sha256', SECRET!).update(data).digest('base64url')
}

function _verifySignedParts(data: string, providedSig: string): any | null {
  const expectedSig = _sign(data)
  try {
    const a = Buffer.from(providedSig, 'base64url')
    const b = Buffer.from(expectedSig, 'base64url')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
