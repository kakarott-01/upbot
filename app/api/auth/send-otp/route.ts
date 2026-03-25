import { NextRequest, NextResponse } from 'next/server'
import { generateOtp, getClientIp } from '@/lib/utils'
import { storeOtp } from '@/lib/redis'
import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
})

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Generate OTP — no whitelist check
    // Security is handled by the access code gate before this page
    const otp = generateOtp()
    await storeOtp(normalizedEmail, otp)

    console.log(`\n🔐 OTP for ${normalizedEmail}: ${otp}\n`) // visible in terminal for testing

    // Send email
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
          <p style="color:#6b7280;font-size:13px;margin-top:16px;">
            Expires in <strong style="color:#9ca3af;">5 minutes</strong>. Single use only.
          </p>
        </div>
      `,
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('send-otp error:', error)
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}