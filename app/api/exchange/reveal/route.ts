import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { exchangeApis } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { decrypt, decryptJSON } from '@/lib/encryption'

// POST /api/exchange/reveal
// Body: { marketType, exchangeName }
// Returns decrypted API key + secret — only callable after OTP is verified
// The OTP verification sets a short-lived cookie 'reveal_token' that this route checks.

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check reveal token cookie (set by /api/exchange/verify-reveal-otp)
  const revealToken = req.cookies.get('reveal_token')?.value
  if (!revealToken) {
    return NextResponse.json({ error: 'OTP verification required' }, { status: 403 })
  }

  // Validate the token: it's a signed string "userId:timestamp"
  // Token is valid for 5 minutes
  try {
    const [tokenUserId, timestamp] = Buffer.from(revealToken, 'base64')
      .toString('utf8')
      .split(':')

    if (tokenUserId !== session.id) {
      return NextResponse.json({ error: 'Invalid reveal token' }, { status: 403 })
    }

    const tokenAge = Date.now() - Number(timestamp)
    if (tokenAge > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Reveal token expired. Please verify OTP again.' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid reveal token' }, { status: 403 })
  }

  const { marketType, exchangeName } = await req.json()

  if (!marketType || !exchangeName) {
    return NextResponse.json({ error: 'marketType and exchangeName required' }, { status: 400 })
  }

  const api = await db.query.exchangeApis.findFirst({
    where: and(
      eq(exchangeApis.userId, session.id),
      eq(exchangeApis.marketType, marketType as any),
      eq(exchangeApis.exchangeName, exchangeName),
    ),
  })

  if (!api) {
    return NextResponse.json({ error: 'Exchange API not found' }, { status: 404 })
  }

  try {
    const apiKey    = decrypt(api.apiKeyEnc)
    const apiSecret = decrypt(api.apiSecretEnc)
    const extra     = api.extraFieldsEnc ? decryptJSON(api.extraFieldsEnc) : {}

    return NextResponse.json({ apiKey, apiSecret, extra })
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt keys' }, { status: 500 })
  }
}