// ═══════════════════════════════════════════════════════════════════════════════
// app/api/exchange/send-reveal-otp/route.ts  — FIXED
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { auth }                       from '@/lib/auth'
import { redis }                      from '@/lib/redis'
import nodemailer                     from 'nodemailer'
import { generateSecureOtp }          from '@/lib/otp'   // FIX: CSPRNG
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitKey = `reveal_otp_rate:${session.id}`
  let limit: { count: number; resetAt: number } | null = null
  const now = Date.now()

  try {
    const raw = await redis.get<string | Record<string, any>>(rateLimitKey)
    if (raw) {
      if (typeof raw === 'string') {
        try { limit = JSON.parse(raw) } catch { limit = null }
      } else {
        limit = raw as { count: number; resetAt: number }
      }
    }
  } catch (redisError) {
    console.error('Redis unavailable during reveal OTP rate-limit read:', redisError)
    return NextResponse.json(
      { error: 'Verification service temporarily unavailable. Please try again.' },
      { status: 503 },
    )
  }

  if (limit && now < limit.resetAt && limit.count >= 3) {
    return NextResponse.json({ error: 'Too many requests. Wait a few minutes.' }, { status: 429 })
  }

  const newLimit = (!limit || now >= limit.resetAt)
    ? { count: 1, resetAt: now + 10 * 60 * 1000 }
    : { ...limit, count: limit.count + 1 }
  try {
    await redis.set(rateLimitKey, JSON.stringify(newLimit), { ex: 600 })
  } catch (redisError) {
    console.error('Redis unavailable during reveal OTP rate-limit store:', redisError)
    return NextResponse.json(
      { error: 'Verification service temporarily unavailable. Please try again.' },
      { status: 503 },
    )
  }

  const REVEAL_OTP_EXPIRY = Number(process.env.REVEAL_OTP_EXPIRY_SEC) || Number(process.env.OTP_EXPIRY_SEC) || 15 * 60

  // Reuse existing reveal OTP if present so resend keeps same code and TTL
  const revealKey = `reveal_otp:${session.id}`
  let otp = null as string | null
  try {
    const existing = await redis.get<string>(revealKey)
    if (existing) {
      otp = String(existing)
      try { await redis.set(revealKey, otp, { ex: REVEAL_OTP_EXPIRY }) } catch {}
    } else {
      otp = generateSecureOtp()
      await redis.set(revealKey, otp, { ex: REVEAL_OTP_EXPIRY })
    }
  } catch (redisError) {
    console.error('Redis unavailable during reveal OTP store:', redisError)
    return NextResponse.json(
      { error: 'Verification service temporarily unavailable. Please try again.' },
      { status: 503 },
    )
  }

  console.log(`\n🔐 Reveal OTP for ${session.email}: ${otp}\n`)

  const transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_SERVER_HOST,
    port:   Number(process.env.EMAIL_SERVER_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
  })

  try {
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM,
      to:      session.email,
      subject: 'AlgoBot — Verify to view API keys',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:32px;background:#030712;color:#f9fafb;border-radius:16px;">
          <h2 style="color:#1D9E75;margin:0 0 6px;">AlgoBot</h2>
          <p style="color:#9ca3af;margin:0 0 8px;font-size:14px;">Someone (hopefully you) requested to view stored API keys.</p>
          <p style="color:#6b7280;margin:0 0 20px;font-size:13px;">If this wasn't you, ignore this email — your keys are safe.</p>
          <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;text-align:center;letter-spacing:10px;font-size:36px;font-weight:700;color:#1D9E75;">
            ${otp}
          </div>
          <p style="color:#6b7280;font-size:12px;margin-top:16px;">
            Expires in <strong style="color:#9ca3af;">15 minutes</strong>. Single use only.
          </p>
        </div>
      `,
    })
  } catch (err) {
    console.error('Failed to send reveal OTP email:', err)
    return NextResponse.json({ error: 'Failed to send OTP email' }, { status: 500 })
  }

  return NextResponse.json({ success: true, email: session.email })
}
