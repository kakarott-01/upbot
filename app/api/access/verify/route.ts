// ═══════════════════════════════════════════════════════════════════════════════
// app/api/access/verify/route.ts  — FIXED
// ═══════════════════════════════════════════════════════════════════════════════
//
// BUG FIX 1: Removed hard auth guard. Previously returned 401 for unauthenticated
//   users, breaking the login-page "Create account" flow entirely.
//
// BUG FIX 2: Unauthenticated users now receive a `signup_token` cookie (signed JWT
//   with accessCodeId) so /api/access/verify-otp can create their account.
//   Previously this cookie was never set, causing "Access code expired" on OTP step.
//
// TWO PATHS after successful code verification:
//   A) Authenticated (Google OAuth user on /access page):
//      → whitelists user in DB + sets user_session cookie with hasAccess:true
//   B) Unauthenticated (login page "Create account" tab):
//      → sets signup_token cookie so verify-otp can create the account
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { db }                         from '@/lib/db'
import { accessCodes, users }         from '@/lib/schema'
import { eq, and }                    from 'drizzle-orm'
import bcrypt                          from 'bcryptjs'
import { createHash }                  from 'crypto'
import { getClientIp }                 from '@/lib/utils'
import { auth }                        from '@/lib/auth'
import { redis }                       from '@/lib/redis'
import { signSession }                 from '@/lib/signed-cookie'
import { signSignupToken }             from '@/lib/jwt'

const MAX_ATTEMPTS     = 3
const LOCKOUT_DURATION = 30 * 60

async function checkLockout(ip: string): Promise<boolean> {
  const locked = await redis.get(`access_locked:${ip}`)
  return locked !== null
}

async function recordFail(ip: string): Promise<number> {
  const attemptsKey = `access_attempts:${ip}`
  const attempts    = await redis.incr(attemptsKey)
  await redis.expire(attemptsKey, LOCKOUT_DURATION)
  if (attempts >= MAX_ATTEMPTS) {
    await redis.set(`access_locked:${ip}`, '1', { ex: LOCKOUT_DURATION })
  }
  return MAX_ATTEMPTS - attempts
}

async function clearRateLimit(ip: string): Promise<void> {
  await redis.del(`access_attempts:${ip}`)
  await redis.del(`access_locked:${ip}`)
}

function codeSha256(code: string): string {
  return createHash('sha256').update(code.toUpperCase()).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    // FIX: auth() is optional — unauthenticated users are allowed for the
    // "Create account" flow. Authenticated users (Google OAuth) are handled differently.
    const session = await auth()

    const ip     = getClientIp(req)
    const locked = await checkLockout(ip)
    if (locked) {
      return NextResponse.json({ error: 'Too many attempts. Try again in 30 minutes.' }, { status: 429 })
    }

    const body = await req.json().catch(() => ({}))
    const code = body?.code?.toUpperCase().trim()
    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    const sha = codeSha256(code)
    let matchedCode = null

    // ── Fast path: O(1) lookup via SHA-256 index ──────────────────────────────
    const fastMatch = await db.query.accessCodes.findFirst({
      where: and(
        eq(accessCodes.isBurned, false),
        eq((accessCodes as any).codeSha256, sha),
      ),
    }).catch(() => null)   // column may not exist yet — fall through to O(n)

    if (fastMatch) {
      if (fastMatch.expiresAt > new Date()) {
        const isMatch = await bcrypt.compare(code, fastMatch.code)
        if (isMatch) matchedCode = fastMatch
      }
    }

    // ── Slow fallback: O(n) bcrypt loop for codes without sha256 column ───────
    if (!matchedCode) {
      const allValid = await db.query.accessCodes.findMany({
        where: eq(accessCodes.isBurned, false),
      })

      if (allValid.length > 50) {
        console.error(`[access/verify] Too many active codes (${allValid.length}) — refusing O(n) scan`)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
      }

      for (const c of allValid) {
        if ((c as any).codeSha256) continue // already tried these above
        if (c.expiresAt < new Date()) continue
        const isMatch = await bcrypt.compare(code, c.code)
        if (isMatch) { matchedCode = c; break }
      }
    }

    if (!matchedCode) {
      const remaining = await recordFail(ip)
      return NextResponse.json(
        { error: 'Invalid or expired code', attemptsRemaining: Math.max(0, remaining) },
        { status: 401 }
      )
    }

    // ── Burn the code ─────────────────────────────────────────────────────────
    await db.update(accessCodes)
      .set({
        isBurned:    true,
        burnedAt:    new Date(),
        burnedByIp:  ip,
        usedByEmail: session?.email ?? null,
      })
      .where(eq(accessCodes.id, matchedCode.id))

    await clearRateLimit(ip)

    // ── PATH A: Authenticated user (Google OAuth on /access page) ─────────────
    // Whitelist them immediately and update the signed session cookie so
    // the middleware allows them into /dashboard without waiting for JWT rotation.
    if (session?.id && session?.email) {
      await db.update(users)
        .set({ isWhitelisted: true })
        .where(eq(users.email, session.email))

      console.info(`✅ Access granted (authenticated) → ${session.email}`)

      const response = NextResponse.json({ success: true })
      response.cookies.set('user_session', signSession({
        id:        session.id,
        email:     session.email,
        name:      session.name ?? session.email.split('@')[0],
        hasAccess: true,
      }), {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        maxAge:   30 * 24 * 60 * 60,
        path:     '/',
        sameSite: 'lax',
      })
      return response
    }

    // ── PATH B: Unauthenticated user (login page "Create account" tab) ────────
    // Issue a short-lived signup_token JWT so /api/access/verify-otp can verify
    // that a valid access code was burned and create the account.
    const signupToken = signSignupToken({
      accessCodeId: matchedCode.id,
      expiresAt:    Date.now() + 5 * 60 * 1000, // 5 minutes
    })

    console.info(`✅ Access code verified (unauthenticated) ip=${ip}`)

    const response = NextResponse.json({ success: true })
    response.cookies.set('signup_token', signupToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   5 * 60,
      path:     '/',
      sameSite: 'lax',
    })
    return response
  } catch (error) {
    console.error('verify-access error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}