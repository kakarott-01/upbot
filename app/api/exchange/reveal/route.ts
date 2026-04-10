// ═══════════════════════════════════════════════════════════════════════════════
// app/api/exchange/reveal/route.ts  — FIXED
// ═══════════════════════════════════════════════════════════════════════════════
// FIX: Token verification now uses verifySecureToken() (HMAC-SHA256) instead
//      of manually decoding base64(userId:timestamp) which had no integrity.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse }    from 'next/server'
import { auth }                          from '@/lib/auth'
import { db }                            from '@/lib/db'
import { exchangeApis }                  from '@/lib/schema'
import { eq, and }                       from 'drizzle-orm'
import { decrypt, decryptJSON }          from '@/lib/encryption'
import { verifySecureToken }             from '@/lib/secure-token'  // FIX
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  // FIX: Verify HMAC-signed token (was raw base64 — forgeable by anyone with userId)
  const rawToken = req.cookies.get('reveal_token')?.value
  if (!rawToken) {
    return NextResponse.json({ error: 'OTP verification required' }, { status: 403 })
  }

  const result = verifySecureToken(rawToken, 'reveal')
  if (!result.ok) {
    return NextResponse.json({ error: `Invalid reveal token: ${result.reason}` }, { status: 403 })
  }
  if (result.userId !== session.id) {
    return NextResponse.json({ error: 'Token user mismatch' }, { status: 403 })
  }

  const { marketType, exchangeName } = await req.json().catch(() => ({}))

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
