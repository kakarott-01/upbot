import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { PUBLIC_STRATEGY_CATALOG, ensureStrategyCatalogSeeded } from '@/lib/strategies/catalog'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function GET() {
  try {
    await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  await ensureStrategyCatalogSeeded()
  return NextResponse.json({
    strategies: PUBLIC_STRATEGY_CATALOG,
  })
}
