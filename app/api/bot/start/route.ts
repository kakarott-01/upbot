import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { acquireBotLock } from '@/lib/bot-lock'
import { startBotForUser } from '@/lib/bot/start-service'
import { getBotStatusSnapshot } from '@/lib/bot/status-snapshot'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

type MarketName = 'indian' | 'crypto' | 'commodities' | 'global'

const VALID_MARKETS = new Set<MarketName>(['indian', 'crypto', 'commodities', 'global'])

function isMarketName(value: unknown): value is MarketName {
  return typeof value === 'string' && VALID_MARKETS.has(value as MarketName)
}

export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const lock = await acquireBotLock(session.id, 'start')
  if (!lock.acquired) {
    if (lock.isRedisDown) {
      return NextResponse.json(
        { error: 'Lock service temporarily unavailable. Please try again in a few seconds.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: lock.reason }, { status: 429 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const rawMarkets = body?.markets
    const rawConflictOverrides = Array.isArray(body?.conflictOverrides) ? body.conflictOverrides : []

    if (!rawMarkets || !Array.isArray(rawMarkets) || rawMarkets.length === 0) {
      return NextResponse.json({ error: 'No markets specified' }, { status: 400 })
    }

    const invalidMarkets = rawMarkets.filter((market: unknown) => !isMarketName(market))
    if (invalidMarkets.length > 0) {
      return NextResponse.json(
        { error: `Invalid market(s): ${invalidMarkets.join(', ')}` },
        { status: 400 },
      )
    }

    const invalidConflictOverrides = rawConflictOverrides.filter((market: unknown) => !isMarketName(market))
    if (invalidConflictOverrides.length > 0) {
      return NextResponse.json(
        { error: `Invalid conflict override market(s): ${invalidConflictOverrides.join(', ')}` },
        { status: 400 },
      )
    }

    await startBotForUser(session.id, rawMarkets as MarketName[], {
      conflictOverrides: rawConflictOverrides as MarketName[],
    })
    const { snapshot } = await getBotStatusSnapshot(session.id)
    return NextResponse.json({
      success: true,
      ...snapshot,
    })
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400
    const detail = (error as Error & { detail?: unknown }).detail
    return NextResponse.json(
      detail ? { error: (error as Error).message, detail } : { error: (error as Error).message },
      { status },
    )
  } finally {
    await lock.release()
  }
}
