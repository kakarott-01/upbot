import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { backtestRuns, strategyConfigs } from '@/lib/schema'
import { assertBotStoppedForSensitiveMutation } from '@/lib/strategies/locks'
import { upsertUserMarketStrategyConfig } from '@/lib/strategies/config-service'
import { startBotForUser } from '@/lib/bot/start-service'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function POST(_: Request, { params }: { params: { id: string } }) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  try {
    await assertBotStoppedForSensitiveMutation(session.id, 'Stop the bot before deploying a backtest configuration.')

    const run = await db.query.backtestRuns.findFirst({
      where: and(eq(backtestRuns.id, params.id), eq(backtestRuns.userId, session.id)),
    })

    if (!run) {
      return NextResponse.json({ error: 'Backtest not found.' }, { status: 404 })
    }

    const configSnapshot = run.strategyConfigId
      ? await db.query.strategyConfigs.findFirst({
          where: eq(strategyConfigs.id, run.strategyConfigId),
          columns: { strategySettings: true },
        })
      : null

    await upsertUserMarketStrategyConfig({
      userId: session.id,
      marketType: run.marketType,
      executionMode: run.executionMode,
      positionMode: run.positionMode,
      allowHedgeOpposition: run.allowHedgeOpposition,
      conflictBlocking: false,
      aggressiveConfirmed: run.executionMode === 'AGGRESSIVE',
      maxPositionsPerSymbol: 2,
      maxCapitalPerStrategyPct: 25,
      maxDrawdownPct: 12,
      strategyKeys: run.strategyKeys ?? [],
      strategySettings: (configSnapshot?.strategySettings as Record<string, any> | undefined) ?? {},
    })

    const result = await startBotForUser(session.id, [run.marketType])
    return NextResponse.json({
      success: true,
      deployedFromBacktestId: run.id,
      result,
    })
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400
    return NextResponse.json({ error: (error as Error).message }, { status })
  }
}
