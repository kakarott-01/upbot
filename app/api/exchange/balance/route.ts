// app/api/exchange/balance/route.ts
// ====================================
// Proxies live exchange balance from the bot engine.
// Returns per-market available balance when the bot is running.
// Used by the Performance page to show real exchange balance in Live mode.

import { NextRequest, NextResponse } from 'next/server'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export const maxDuration = 10

export type LiveBalanceData = {
  markets: Record<string, { balance: number | null; currency: string }>
  running: boolean
}

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  try {
    const res = await fetch(
      `${process.env.BOT_ENGINE_URL}/bot/balance/${session.id}`,
      {
        headers: { 'X-Bot-Secret': process.env.BOT_ENGINE_SECRET ?? '' },
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      return NextResponse.json({ markets: {}, running: false } satisfies LiveBalanceData)
    }

    const data = await res.json() as LiveBalanceData
    const response = NextResponse.json(data)
    response.headers.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    return response
  } catch {
    return NextResponse.json({ markets: {}, running: false } satisfies LiveBalanceData)
  }
}
