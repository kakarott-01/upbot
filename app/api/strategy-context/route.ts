import { NextResponse } from 'next/server'
import { guardErrorResponse, requireAccess } from '@/lib/guards'
import { buildStrategyContextResponse, readStrategyContextCache, writeStrategyContextCache } from '@/lib/strategies/context-cache'

export const maxDuration = 10

export async function GET() {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const cached = await readStrategyContextCache(session.id)
  if (cached) {
    return NextResponse.json(cached)
  }

  const responseData = await buildStrategyContextResponse(session.id)
  await writeStrategyContextCache(session.id, responseData)
  return NextResponse.json(responseData)
}
