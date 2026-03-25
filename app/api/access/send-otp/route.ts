import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getClientIp } from '@/lib/utils'

// Global OTP store shared across routes in same process
declare global {
  var __otpStore: Map<string, { otp: string; expiresAt: number }>
}
global.__otpStore = global.__otpStore ?? new Map()

// Rate limit state in-memory (per-instance)
const OTP_RATE_LIMIT = 3
const OTP_WINDOW_MS = 5 * 60 * 1000

const emailRateMap = new Map<string, { count: number; firstTs: number }>()
const ipRateMap = new Map<string, { count: number; firstTs: number }>()

function canSendOtp(key: string, map: Map<string, { count: number; firstTs: number }>) {
  const now = Date.now()
  const entry = map.get(key)
  if (!entry) {
    map.set(key, { count: 1, firstTs: now })
    return { ok: true, remaining: OTP_RATE_LIMIT - 1 }
  }

  if (now - entry.firstTs > OTP_WINDOW_MS) {
    map.set(key, { count: 1, firstTs: now })
    return { ok: true, remaining: OTP_RATE_LIMIT - 1 }
  }

  if (entry.count >= OTP_RATE_LIMIT) {
    return { ok: false, remaining: 0 }
  }

  entry.count += 1
  map.set(key, entry)
  return { ok: true, remaining: OTP_RATE_LIMIT - entry.count }
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const ip = getClientIp(req)

    // Rate limit (by IP + by email)
    const ipLimit = canSendOtp(ip, ipRateMap)
    if (!ipLimit.ok) {
      console.warn(`Rate limit exceeded for IP=${ip}`)
      return NextResponse.json({ error: 'Too many OTP requests from this IP. Try again later.' }, { status: 429 })
    }

    const emailLimit = canSendOtp(normalizedEmail, emailRateMap)
    if (!emailLimit.ok) {
      console.warn(`Rate limit exceeded for email=${normalizedEmail}`)
      return NextResponse.json({ error: 'Too many OTP requests for this email. Try again later.' }, { status: 429 })
    }

    const otp = generateOtp()

    // Store in global map
    global.__otpStore.set(normalizedEmail, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    })

    // Always log to terminal
    console.log(`\n🔐 OTP for ${normalizedEmail}: ${otp}\n`)

    const transporter = nodemailer.createTransport({
      host:   process.env.EMAIL_SERVER_HOST,
      port:   Number(process.env.EMAIL_SERVER_PORT ?? 587),
      secure: false,
      auth: {
        user: process.env.EMAIL_SERVER_USER,
        pass: process.env.EMAIL_SERVER_PASSWORD,
      },
    })

    await transporter.sendMail({
      from:    process.env.EMAIL_FROM,
      to:      normalizedEmail,
      subject: 'Your AlgoBot login code',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#030712;color:#f9fafb;border-radius:16px;">
          <h2 style="color:#1D9E75;margin-bottom:8px;">AlgoBot</h2>
          <p style="color:#9ca3af;margin-bottom:20px;">Your one-time login code:</p>
          <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;text-align:center;letter-spacing:10px;font-size:36px;font-weight:700;color:#1D9E75;">
            ${otp}
          </div>
          <p style="color:#6b7280;font-size:13px;margin-top:16px;">Expires in 5 minutes. Single use only.</p>
        </div>
      `,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('send-otp error:', error)
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}