/**
 * Central registry of React Query keys.
 * Import these instead of using inline string literals.
 */

const FINANCIAL_META = { financial: true } as const

function financialKey<const T extends readonly unknown[]>(key: T) {
  return key
}

export function isFinancialQueryKey(queryKey: readonly unknown[] | undefined) {
  return Boolean(queryKey?.some((part) => (
    typeof part === 'object' &&
    part !== null &&
    'financial' in part &&
    (part as { financial?: unknown }).financial === true
  )))
}

export const QUERY_KEYS = {
  BOT_STATUS: ['bot-status'] as const,
  MARKET_MODES: ['market-modes'] as const,
  STRATEGY_CONFIGS: ['strategy-configs'] as const,
  STRATEGY_CATALOG: ['strategy-catalog'] as const,
  STRATEGY_CONTEXT: ['strategy-context'] as const,
  RISK_SETTINGS: ['risk-settings'] as const,
  EXCHANGE_APIS: ['exchange-apis'] as const,
  ME: ['me'] as const,
  TRADES: (filters?: { market?: string; status?: string; mode?: string; page?: number }) =>
    financialKey(filters ? ['trades', FINANCIAL_META, filters] as const : ['trades', FINANCIAL_META] as const),
  TRADES_SUMMARY: financialKey(['trades-summary', FINANCIAL_META] as const),
  PERFORMANCE: (filters?: { mode?: string; market?: string }) =>
    financialKey(filters ? ['performance', FINANCIAL_META, filters] as const : ['performance', FINANCIAL_META] as const),
  // Backwards-compat alias used in several places for the dashboard chart
  PERFORMANCE_CHART: ['performance-chart'] as const,
  DAILY_PNL: (filters?: { mode?: string; market?: string }) =>
    financialKey(filters ? ['daily-pnl', FINANCIAL_META, filters] as const : ['daily-pnl', FINANCIAL_META] as const),
  BOT_HISTORY: (filters?: { page?: number; mode?: string; exchange?: string; from?: string; to?: string }) =>
    filters ? ['bot-history', filters] : ['bot-history'],
  MODE_AUDIT: ['mode-audit'] as const,
} as const
