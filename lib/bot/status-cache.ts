import { redis } from '@/lib/redis'
import type { BotStatusSnapshotData } from '@/lib/bot/status-snapshot'

export const BOT_STATUS_SNAPSHOT_TTL_SEC = 5

function getBotStatusSnapshotCacheKey(userId: string) {
  return `bot_status_snapshot:${userId}`
}

export async function readCachedBotStatusSnapshot(userId: string): Promise<BotStatusSnapshotData | null> {
  try {
    const cached = await redis.get<string>(getBotStatusSnapshotCacheKey(userId))
    if (typeof cached !== 'string') return null

    const parsed = JSON.parse(cached)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.status !== 'string' ||
      !Array.isArray(parsed.activeMarkets)
    ) {
      return null
    }

    return parsed as BotStatusSnapshotData
  } catch (error) {
    console.warn('[bot/status-cache] Read failed:', error)
    return null
  }
}

export async function writeCachedBotStatusSnapshot(userId: string, snapshot: BotStatusSnapshotData) {
  try {
    await redis.set(
      getBotStatusSnapshotCacheKey(userId),
      JSON.stringify(snapshot),
      { ex: BOT_STATUS_SNAPSHOT_TTL_SEC },
    )
  } catch (error) {
    console.warn('[bot/status-cache] Write failed:', error)
  }
}

export async function invalidateCachedBotStatusSnapshot(userId: string) {
  try {
    await redis.del(getBotStatusSnapshotCacheKey(userId))
  } catch (error) {
    console.warn('[bot/status-cache] Invalidate failed:', error)
  }
}
