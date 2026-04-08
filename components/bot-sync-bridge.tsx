'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  applyBotStatusSnapshot,
  getBotStatusSignature,
  getBotSyncEventType,
  type BotStatusSnapshot,
} from '@/lib/bot-status-client'
import {
  createBotSyncChannel,
  createTabId,
  emitBotSyncEvent,
  isBotStatusQueryKey,
  readBotSyncStorageEvent,
  BOT_SYNC_STORAGE_KEY,
  type BotSyncEvent,
} from '@/lib/bot-sync'

export function BotSyncBridge() {
  const queryClient = useQueryClient()
  const tabIdRef = useRef<string>(createTabId())
  const lastBroadcastSignatureRef = useRef<string | null>(null)
  const lastExternalSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    const channel = createBotSyncChannel()

    const handleIncomingSnapshot = (event: BotSyncEvent | null) => {
      if (!event || event.originTabId === tabIdRef.current) return

      const signature = getBotStatusSignature(event.snapshot)
      lastExternalSignatureRef.current = signature
      applyBotStatusSnapshot(queryClient, event.snapshot, `broadcast:${event.type}`)
      void queryClient.invalidateQueries({ queryKey: ['bot-history'], refetchType: 'active' })
    }

    const handleBroadcastMessage = (message: MessageEvent<BotSyncEvent>) => {
      handleIncomingSnapshot(message.data)
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== BOT_SYNC_STORAGE_KEY) return
      handleIncomingSnapshot(readBotSyncStorageEvent(event.newValue))
    }

    channel?.addEventListener('message', handleBroadcastMessage)
    window.addEventListener('storage', handleStorage)

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const query = event?.query
      if (!query || !isBotStatusQueryKey(query.queryKey)) return

      const snapshot = query.state.data as BotStatusSnapshot | undefined
      if (!snapshot) return

      const signature = getBotStatusSignature(snapshot)
      if (signature === lastBroadcastSignatureRef.current) return

      if (signature === lastExternalSignatureRef.current) {
        lastExternalSignatureRef.current = null
        lastBroadcastSignatureRef.current = signature
        return
      }

      lastBroadcastSignatureRef.current = signature
      emitBotSyncEvent(channel, {
        id: `${tabIdRef.current}:${signature}`,
        originTabId: tabIdRef.current,
        emittedAt: new Date().toISOString(),
        type: getBotSyncEventType(snapshot),
        snapshot,
      })
    })

    return () => {
      unsubscribe()
      channel?.removeEventListener('message', handleBroadcastMessage)
      channel?.close()
      window.removeEventListener('storage', handleStorage)
    }
  }, [queryClient])

  return null
}
