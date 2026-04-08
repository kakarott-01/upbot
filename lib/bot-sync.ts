'use client'

import { BOT_STATUS_QUERY_KEY, type BotStatusSnapshot } from '@/lib/bot-status-client'

const BOT_SYNC_CHANNEL_NAME = 'bot-sync'
export const BOT_SYNC_STORAGE_KEY = 'bot-sync:event'

export type BotSyncEventType = 'BOT_STARTED' | 'BOT_STOPPED' | 'BOT_UPDATED'

export type BotSyncEvent = {
  id: string
  originTabId: string
  emittedAt: string
  type: BotSyncEventType
  snapshot: BotStatusSnapshot
}

export function createTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

export function createBotSyncChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null
  }

  return new BroadcastChannel(BOT_SYNC_CHANNEL_NAME)
}

export function writeBotSyncStorageEvent(event: BotSyncEvent) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(BOT_SYNC_STORAGE_KEY, JSON.stringify(event))
  } catch {
    // localStorage is only a fallback transport; ignore failures.
  }
}

export function readBotSyncStorageEvent(value: string | null): BotSyncEvent | null {
  if (!value) return null

  try {
    return JSON.parse(value) as BotSyncEvent
  } catch {
    return null
  }
}

export function emitBotSyncEvent(channel: BroadcastChannel | null, event: BotSyncEvent) {
  if (channel) {
    channel.postMessage(event)
  }

  writeBotSyncStorageEvent(event)
}

export function isBotStatusQueryKey(queryKey: readonly unknown[]) {
  return queryKey.length === BOT_STATUS_QUERY_KEY.length && queryKey[0] === BOT_STATUS_QUERY_KEY[0]
}
