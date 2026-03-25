import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accessCodes } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { getClientIp } from '@/lib/utils'

// Simple in-memory rate limiting (works without Redis)
const attemptMap = new Map<string, { count: number; lockedUntil?: number }>()

function checkAndRecordAttempt(ip: string): { locked: boolean; remaining: number } {
  const now = Date.now()
  const entry = attemptMap.get(ip) ?? { count: 0 }

  // Check if locked
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return { locked: true, remaining: 0 }
  }

  // Reset if lock expired
  if (entry.lockedUntil && now >= entry.lockedUntil) {
    attemptMap.set(ip, { count: 0 })
    return { locked: false, remaining: 3 }
  }

  return { locked: false, remaining: Math.max(0, 3 - entry.count) }
}

function recordFailedAttempt(ip: string): number {
  const entry = attemptMap.get(ip) ?? { count: 0 }
  const newCount = entry.count + 1
  if (newCount >= 3) {
    attemptMap.set(ip, { count: newCount, lockedUntil: Date.now() + 30 * 60 * 1000 })
  } else {
    attemptMap.set(ip, { count: newCount })
  }
  return Math.max(0, 3 - newCount)
}

function clearAttempts(ip: string) {
  attemptMap.delete(ip)
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)

    // Check lockout
    const { locked, remaining } = checkAndRecordAttempt(ip)
    if (locked) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again in 30 minutes.' },
        { status: 429 }
      )
    }

    const body = await req.json()
    const { code } = body

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    // Find all non-burned, non-expired codes
    const validCodes = await db.query.accessCodes.findMany({
      where: eq(accessCodes.isBurned, false),
    })

    // Check against each hashed code
    let matchedCode = null
    for (const c of validCodes) {
      const now = new Date()
      if (c.expiresAt < now) continue
      const matches = await bcrypt.compare(code.toUpperCase().trim(), c.code)
      if (matches) { matchedCode = c; break }
    }

    if (!matchedCode) {
      const rem = recordFailedAttempt(ip)
      return NextResponse.json(
        { error: 'Invalid or expired code', attemptsRemaining: rem },
        { status: 401 }
      )
    }

    // Burn the code
    await db.update(accessCodes)
      .set({ isBurned: true, burnedAt: new Date(), burnedByIp: ip })
      .where(eq(accessCodes.id, matchedCode.id))

    clearAttempts(ip)

    // Set a cookie so the login page knows access was validated
    const response = NextResponse.json({ success: true })
    response.cookies.set('access_validated', '1', {
      httpOnly: true,
      maxAge: 30 * 60, // 30 minutes
      path: '/',
    })
    return response

  } catch (error) {
    console.error('verify-code error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}