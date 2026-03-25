import { NextRequest, NextResponse } from 'next/server'
import { verifyOtp } from '@/lib/redis'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  try {
    const { email, otp } = await req.json()
    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Verify OTP
    const valid = await verifyOtp(normalizedEmail, otp)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }

    // Find or auto-create user
    let user = await db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    })

    if (!user) {
      const [newUser] = await db.insert(users).values({
        email:         normalizedEmail,
        name:          normalizedEmail.split('@')[0],
        isWhitelisted: true,
        isActive:      true,
      }).returning()
      user = newUser
      console.log(`✅ Auto-created user: ${normalizedEmail}`)
    }

    await db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.email, normalizedEmail))

    // Set session cookie directly
    const response = NextResponse.json({ success: true })
    response.cookies.set('user_session', JSON.stringify({
      id:    user.id,
      email: user.email,
      name:  user.name,
    }), {
      httpOnly: true,
      maxAge:   30 * 24 * 60 * 60, // 30 days
      path:     '/',
      sameSite: 'lax',
    })
    return response

  } catch (error) {
    console.error('verify-otp error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}