import { NextRequest, NextResponse } from 'next/server'
import { neon }                       from '@neondatabase/serverless'
import { verifySignupToken }          from '@/lib/jwt'
import { db }                         from '@/lib/db'
import { accessCodes }                from '@/lib/schema'
import { eq }                         from 'drizzle-orm'
import { redis, verifyOtp }          from '@/lib/redis'
import { signSession }                from '@/lib/signed-cookie'  // FIX: signed cookie
import {
  checkOtpVerifyLimit,
  otpVerifyLimitMessage,
  resetOtpVerifyLimit,
} from '@/lib/otp-rate-limit'

const sql = neon(process.env.DATABASE_URL!)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { email, otp } = body
    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const limitKey = `login_otp:${normalizedEmail}`

    const rateLimit = await checkOtpVerifyLimit(limitKey)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: otpVerifyLimitMessage(rateLimit.retryAfterSec) },
        { status: 429 },
      )
    }

    // ── Verify OTP using helper ─────────────────────────────────────────────────
    try {
      const ok = await verifyOtp(normalizedEmail, otp)
      if (!ok) {
        return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
      }
    } catch (redisError) {
      console.error('verify-otp redis error:', redisError)
      return NextResponse.json(
        { error: 'Verification service temporarily unavailable. Please try again.' },
        { status: 503 },
      )
    }

    try {
      await resetOtpVerifyLimit(limitKey)
    } catch (e) {
      // Non-fatal: continue
    }

    // Find existing user
    const existing = await sql`
      SELECT id, is_whitelisted
      FROM users
      WHERE email = ${normalizedEmail}
      LIMIT 1
    `
    let userId: string

    const signupToken = req.cookies.get('signup_token')?.value

    if (existing.length > 0) {
      if (signupToken) {
        return NextResponse.json({ error: 'User already exists. Please login.' }, { status: 409 })
      }

      userId = existing[0].id
      await sql`UPDATE users SET last_login_at = now() WHERE email = ${normalizedEmail}`
    } else {
      if (!signupToken) {
        return NextResponse.json({ error: 'Access code expired. Please verify again.' }, { status: 403 })
      }

      let payload
      try {
        payload = verifySignupToken(signupToken)
      } catch (err) {
        console.warn('Invalid signup token:', err)
        return NextResponse.json({ error: 'Access code expired. Please verify again.' }, { status: 403 })
      }

      const codeRecord = await db.query.accessCodes.findFirst({
        where: eq(accessCodes.id, payload.accessCodeId),
      })

      if (!codeRecord || !codeRecord.isBurned) {
        return NextResponse.json({ error: 'Access code expired. Please verify again.' }, { status: 403 })
      }

      const newUser = await sql`
        INSERT INTO users (id, email, name, is_whitelisted, is_active, created_at)
        VALUES (gen_random_uuid(), ${normalizedEmail}, ${normalizedEmail.split('@')[0]}, true, true, now())
        RETURNING id
      `
      userId = newUser[0].id
      console.info(`✅ New user created: ${normalizedEmail}`)

      // FIX: sign the session cookie with HMAC
      const sessionPayload = {
        id: userId,
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0],
        hasAccess: true,
      }
      const postResponse   = NextResponse.json({ success: true })
      postResponse.cookies.delete('signup_token')
      postResponse.cookies.set('user_session', signSession(sessionPayload), {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        maxAge:   30 * 24 * 60 * 60,
        path:     '/',
        sameSite: 'lax',
      })

      return postResponse
    }

    // FIX: sign the session cookie with HMAC
    const sessionPayload = {
      id: userId,
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0],
      hasAccess: Boolean(existing[0]?.is_whitelisted),
    }
    const response       = NextResponse.json({ success: true })
    response.cookies.set('user_session', signSession(sessionPayload), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   30 * 24 * 60 * 60,
      path:     '/',
      sameSite: 'lax',
    })
    response.cookies.delete('signup_token')

    return response
  } catch (error) {
    console.error('verify-otp error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
