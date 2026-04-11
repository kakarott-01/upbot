export const POLL_INTERVALS = {
  BOT_RUNNING: 8000,
  BOT_IDLE: 15000,
  MARKET_MODES: 15000,
  STRATEGY: 30000,
} as const

export type PollIntervalKey = keyof typeof POLL_INTERVALS
