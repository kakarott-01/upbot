/**
 * lib/currency.ts
 * ================
 * Market-aware currency formatting.
 *
 * Market → quote currency mapping:
 *   indian      → INR  (NSE/BSE quoted in ₹)
 *   commodities → INR  (MCX quoted in ₹)
 *   crypto      → USDT (default) | INR (if symbol ends /INR) | USD (if /USD)
 *   global      → USD  (US/international equities and forex)
 *
 * This is intentionally simple — we read the quote from the symbol when
 * available and fall back to the market default. No live FX rates needed.
 */

export type MarketCurrency = 'INR' | 'USDT' | 'USD'

/** Derive the quote currency from market type and (optionally) the symbol. */
export function getMarketCurrency(
  marketType: string,
  symbol?: string | null,
): MarketCurrency {
  switch (marketType) {
    case 'indian':
    case 'commodities':
      return 'INR'

    case 'global':
      return 'USD'

    case 'crypto': {
      if (!symbol) return 'USDT'
      const upper = symbol.toUpperCase()
      // Explicit INR pairs (some Indian crypto exchanges)
      if (upper.endsWith('/INR') || upper.includes(':INR')) return 'INR'
      // Plain USD (not USDT) — rare but handle it
      if ((upper.endsWith('/USD') || upper.includes(':USD')) && !upper.includes('USDT')) return 'USD'
      // Everything else (BTC/USDT, ETH/USDT, …)
      return 'USDT'
    }

    default:
      return 'INR'
  }
}

/** The prefix symbol for each currency. */
export const CURRENCY_PREFIX: Record<MarketCurrency, string> = {
  INR:  '₹',
  USDT: '$',
  USD:  '$',
}

/** An optional suffix to disambiguate $ USDT vs $ USD. */
export const CURRENCY_SUFFIX: Record<MarketCurrency, string> = {
  INR:  '',
  USDT: ' USDT',
  USD:  '',
}

/**
 * Format an absolute amount with the correct currency symbol.
 * Always treats the value as positive (sign handling is caller's job).
 */
export function formatAmount(amount: number, currency: MarketCurrency): string {
  const abs = Math.abs(amount)
  const prefix = CURRENCY_PREFIX[currency]
  const suffix = CURRENCY_SUFFIX[currency]

  if (currency === 'INR') {
    return `${prefix}${abs.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}${suffix}`
  }

  // USD / USDT — use up to 4 decimal places so small amounts aren't truncated
  return `${prefix}${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}${suffix}`
}

/**
 * Format a signed P&L value with leading + / -.
 * e.g.  3.14  → "+$3.14 USDT"
 *       -7.45 → "-$7.45 USDT"
 */
export function formatPnlAmount(amount: number, currency: MarketCurrency): string {
  const sign = amount >= 0 ? '+' : '-'
  return `${sign}${formatAmount(amount, currency)}`
}

/**
 * Returns a human-readable label for the currency.
 * Used in chart axis labels and mixed-portfolio warnings.
 */
export function currencyLabel(currency: MarketCurrency): string {
  switch (currency) {
    case 'INR':  return 'INR (₹)'
    case 'USDT': return 'USDT ($)'
    case 'USD':  return 'USD ($)'
  }
}

/**
 * True when the supplied market types span more than one quote currency.
 * Used to show a "mixed currencies" warning on aggregate views.
 */
export function isMixedCurrencySet(marketTypes: string[]): boolean {
  const currencies = new Set(marketTypes.map((m) => getMarketCurrency(m)))
  return currencies.size > 1
}