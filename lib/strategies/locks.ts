import { db } from '@/lib/db'
import { botSessions, botStatuses } from '@/lib/schema'
import { and, eq, sql } from 'drizzle-orm'

/**
 * Throws a 409 if the bot is running.
 *
 * When `marketType` is provided, only throws if that specific market is
 * currently active — letting users edit strategies for idle markets while
 * other markets keep running.
 *
 * When `marketType` is omitted, uses a global check (any market running).
 */
export async function assertBotStoppedForSensitiveMutation(
  userId: string,
  errorMessage = 'Stop the bot before changing this configuration.',
  marketType?: string,
) {
  const [status, activeSessions] = await Promise.all([
    db.query.botStatuses.findFirst({
      where: eq(botStatuses.userId, userId),
      columns: { status: true, activeMarkets: true },
    }),
    db.query.botSessions.findMany({
      where: and(
        eq(botSessions.userId, userId),
        marketType ? eq(botSessions.market, marketType) : sql`true`,
        sql`${botSessions.status} IN ('running', 'stopping')`,
      ),
      columns: { market: true },
    }),
  ])

  const statusIsActive = status?.status === 'running' || status?.status === 'stopping'

  if (!statusIsActive && (status?.activeMarkets?.length ?? 0) > 0) {
    await db.update(botStatuses)
      .set({ activeMarkets: [], updatedAt: new Date() })
      .where(and(
        eq(botStatuses.userId, userId),
        sql`${botStatuses.status} NOT IN ('running', 'stopping')`,
      ))
      .catch((error) => {
        console.warn(`[strategy-lock] Failed to clear stale activeMarkets for user=${userId}:`, error)
      })
  }

  if (marketType) {
    // Per-market: only block if THIS market is active. Ignore stale
    // bot_statuses.activeMarkets when the bot row is already stopped.
    const activeMarkets = statusIsActive ? ((status?.activeMarkets ?? []) as string[]) : []
    if (activeMarkets.includes(marketType) || activeSessions.length > 0) {
      const error = new Error(errorMessage)
      ;(error as Error & { status?: number }).status = 409
      throw error
    }
  } else {
    // Global fallback: block when the bot row or live session records say
    // any market is running/stopping.
    if (statusIsActive || activeSessions.length > 0) {
      const error = new Error(errorMessage)
      ;(error as Error & { status?: number }).status = 409
      throw error
    }
  }
}
