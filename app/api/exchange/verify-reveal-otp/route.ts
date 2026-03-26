import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

declare global {
  var __revealOtpStore: Map<string, { otp: string; expiresAt: number }>
}
global.__revealOtpStore = global.__revealOtpStore ?? new Map()

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { otp } = await req.json()
  if (!otp || typeof otp !== 'string') {
    return NextResponse.json({ error: 'OTP required' }, { status: 400 })
  }

  const entry = global.__revealOtpStore.get(session.id)

  if (!entry) {
    return NextResponse.json({ error: 'No OTP found. Please request a new one.' }, { status: 401 })
  }

  if (Date.now() > entry.expiresAt) {
    global.__revealOtpStore.delete(session.id)
    return NextResponse.json({ error: 'OTP expired. Please request a new one.' }, { status: 401 })
  }

  if (entry.otp !== otp.trim()) {
    return NextResponse.json({ error: 'Invalid OTP.' }, { status: 401 })
  }

  // Burn OTP
  global.__revealOtpStore.delete(session.id)

  // Issue a short-lived reveal token cookie (5 minutes)
  // Token = base64("userId:timestamp") — simple, no external dependency
  const token = Buffer.from(`${session.id}:${Date.now()}`).toString('base64')

  const response = NextResponse.json({ success: true })
  response.cookies.set('reveal_token', token, {
    httpOnly: true,
    maxAge:   5 * 60,    // 5 minutes
    path:     '/',
    sameSite: 'strict',
  })

  return response
}