// app/api/mode/send-otp/route.ts
//
// Sends a dedicated OTP for confirming paper → live mode switch.
// Separate from the "view API keys" OTP so the email subject is correct.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { redis } from '@/lib/redis'
import nodemailer from 'nodemailer'

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.id || !session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit: max 3 per 10 minutes per user
  const rateLimitKey = `mode_otp_rate:${session.id}`
  const raw          = await redis.get<string>(rateLimitKey)
  const limit        = raw ? JSON.parse(raw) : null
  const now          = Date.now()

  if (limit && now < limit.resetAt && limit.count >= 3) {
    return NextResponse.json({ error: 'Too many requests. Wait a few minutes.' }, { status: 429 })
  }

  const newLimit = (!limit || now >= limit.resetAt)
    ? { count: 1, resetAt: now + 10 * 60 * 1000 }
    : { ...limit, count: limit.count + 1 }
  await redis.set(rateLimitKey, JSON.stringify(newLimit), { ex: 600 })

  const otp = generateOtp()
  // Store in Redis with 5 min TTL, keyed separately from reveal-OTP
  await redis.set(`mode_switch_otp:${session.id}`, otp, { ex: 300 })

  console.log(`\n🔐 Mode-switch OTP for ${session.email}: ${otp}\n`)

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
      subject: 'AlgoBot — Confirm switch to Live Trading',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:32px;background:#030712;color:#f9fafb;border-radius:16px;">
          <h2 style="color:#1D9E75;margin:0 0 6px;">AlgoBot</h2>
          <p style="color:#9ca3af;margin:0 0 8px;font-size:14px;">You requested to switch a market to <strong style="color:#ef4444;">LIVE trading</strong>.</p>
          <p style="color:#6b7280;margin:0 0 20px;font-size:13px;">Real funds will be used. If this wasn't you, ignore this email — no changes have been made.</p>
          <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;text-align:center;letter-spacing:10px;font-size:36px;font-weight:700;color:#ef4444;">
            ${otp}
          </div>
          <p style="color:#6b7280;font-size:12px;margin-top:16px;">
            Expires in <strong style="color:#9ca3af;">5 minutes</strong>. Single use only.
          </p>
        </div>
      `,
    })
  } catch (err) {
    console.error('Failed to send mode-switch OTP:', err)
    return NextResponse.json({ error: 'Failed to send OTP email' }, { status: 500 })
  }

  return NextResponse.json({ success: true, email: session.email })
}