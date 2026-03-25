import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accessCodes, users } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { getClientIp } from '@/lib/utils'
import { getToken } from 'next-auth/jwt'

const attemptMap = new Map<string, { count: number; lockedUntil?: number }>()

// 🔐 Check lockout
function checkLockout(ip: string): { locked: boolean; remaining: number } {
  const now = Date.now()
  const entry = attemptMap.get(ip) ?? { count: 0 }

  if (entry.lockedUntil && now < entry.lockedUntil) {
    return { locked: true, remaining: 0 }
  }

  if (entry.lockedUntil && now >= entry.lockedUntil) {
    attemptMap.set(ip, { count: 0 })
    return { locked: false, remaining: 3 }
  }

  return { locked: false, remaining: Math.max(0, 3 - entry.count) }
}

// ❌ Record failed attempt
function recordFail(ip: string): number {
  const entry = attemptMap.get(ip) ?? { count: 0 }
  const newCount = entry.count + 1

  if (newCount >= 3) {
    attemptMap.set(ip, {
      count: newCount,
      lockedUntil: Date.now() + 30 * 60 * 1000, // 30 min
    })
  } else {
    attemptMap.set(ip, { count: newCount })
  }

  return Math.max(0, 3 - newCount)
}

export async function POST(req: NextRequest) {
  try {
    // 🔐 1. Validate session
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    })

    if (!token?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 🌐 2. Get IP + check lockout
    const ip = getClientIp(req)
    const { locked } = checkLockout(ip)

    if (locked) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again in 30 minutes.' },
        { status: 429 }
      )
    }

    // 🧾 3. Get code from body
    const body = await req.json()
    const code = body?.code?.toUpperCase().trim()

    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    // 🔍 4. Fetch valid (not burned) codes
    const validCodes = await db.query.accessCodes.findMany({
      where: eq(accessCodes.isBurned, false),
    })

    let matchedCode = null

    // 🔑 5. Compare hashed codes
    for (const c of validCodes) {
      if (c.expiresAt < new Date()) continue

      const isMatch = await bcrypt.compare(code, c.code)
      if (isMatch) {
        matchedCode = c
        break
      }
    }

    // ❌ 6. Invalid code
    if (!matchedCode) {
      const remaining = recordFail(ip)

      return NextResponse.json(
        {
          error: 'Invalid or expired code',
          attemptsRemaining: remaining,
        },
        { status: 401 }
      )
    }

    // 🔥 7. Burn the code
    await db
      .update(accessCodes)
      .set({
        isBurned: true,
        burnedAt: new Date(),
        burnedByIp: ip,
        usedByEmail: token.email,
      })
      .where(eq(accessCodes.id, matchedCode.id))

    // ✅ 8. Whitelist user
    await db
      .update(users)
      .set({ isWhitelisted: true })
      .where(eq(users.email, token.email))

    // 🧹 9. Reset attempts
    attemptMap.delete(ip)

    console.info(`✅ Access granted → ${token.email}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('verify-access error:', error)

    return NextResponse.json(
      { error: 'Server error' },
      { status: 500 }
    )
  }
}