// ═══════════════════════════════════════════════════════════════════════════════
// app/api/mode/verify-otp/route.ts  — FIXED
// ═══════════════════════════════════════════════════════════════════════════════
// FIX: Replaced base64(userId:timestamp) token with HMAC-signed token.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { auth }                       from '@/lib/auth'
import { redis }                      from '@/lib/redis'
import { issueSecureToken }           from '@/lib/secure-token'  // FIX

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { otp } = await req.json().catch(() => ({}))
  if (!otp || typeof otp !== 'string') {
    return NextResponse.json({ error: 'OTP required' }, { status: 400 })
  }

  const raw = await redis.get(`mode_switch_otp:${session.id}`)

  if (raw === null || raw === undefined) {
    return NextResponse.json({ error: 'No OTP found. Please request a new one.' }, { status: 401 })
  }

  const stored   = String(raw).trim()
  const provided = otp.trim()

  if (stored !== provided) {
    return NextResponse.json({ error: 'Invalid OTP.' }, { status: 401 })
  }

  // Burn OTP
  await redis.del(`mode_switch_otp:${session.id}`)

  // FIX: HMAC-signed token (was base64(userId:timestamp) — forgeable)
  const token = issueSecureToken(session.id, 'mode_switch')

  const response = NextResponse.json({ success: true })
  response.cookies.set('mode_switch_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   5 * 60,
    path:     '/',
    sameSite: 'strict',
  })

  return response
}