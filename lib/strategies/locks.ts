import { db } from '@/lib/db'
import { botStatuses } from '@/lib/schema'
import { eq } from 'drizzle-orm'

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
  const status = await db.query.botStatuses.findFirst({
    where: eq(botStatuses.userId, userId),
    columns: { status: true, activeMarkets: true },
  })

  if (marketType) {
    // Per-market: only block if THIS market is in the active set
    const activeMarkets = ((status?.activeMarkets ?? []) as string[])
    if (activeMarkets.includes(marketType)) {
      const error = new Error(errorMessage)
      ;(error as Error & { status?: number }).status = 409
      throw error
    }
  } else {
    // Global (legacy fallback): block when bot is running on any market
    if (status?.status === 'running' || status?.status === 'stopping') {
      const error = new Error(errorMessage)
      ;(error as Error & { status?: number }).status = 409
      throw error
    }
  }
}