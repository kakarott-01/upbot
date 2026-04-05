import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { and, eq, sql } from 'drizzle-orm'
import { trades } from '@/lib/schema'

export async function GET() {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const openTrades = await db.select({
    symbol: trades.symbol,
    strategyKey: trades.strategyKey,
    side: trades.side,
    notional: sql<number>`COALESCE(${trades.remainingQuantity}, ${trades.quantity}) * ${trades.entryPrice}`,
  }).from(trades).where(and(
    eq(trades.userId, session.id),
    eq(trades.status, 'open'),
  ))

  const perSymbol: Record<string, { strategies: Record<string, number>; net: number; direction: 'LONG' | 'SHORT' | 'FLAT' }> = {}
  const perStrategy: Record<string, number> = {}

  for (const trade of openTrades) {
    const strategyKey = trade.strategyKey ?? 'UNSCOPED'
    const signedNotional = trade.side === 'buy' ? Number(trade.notional) : -Number(trade.notional)

    perSymbol[trade.symbol] ??= { strategies: {}, net: 0, direction: 'FLAT' }
    perSymbol[trade.symbol].strategies[strategyKey] = (perSymbol[trade.symbol].strategies[strategyKey] ?? 0) + signedNotional
    perSymbol[trade.symbol].net += signedNotional
    perSymbol[trade.symbol].direction = perSymbol[trade.symbol].net > 0
      ? 'LONG'
      : perSymbol[trade.symbol].net < 0
        ? 'SHORT'
        : 'FLAT'

    perStrategy[strategyKey] = (perStrategy[strategyKey] ?? 0) + Math.abs(Number(trade.notional))
  }

  return NextResponse.json({ perSymbol, perStrategy })
}
