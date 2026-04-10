import { NextResponse } from 'next/server'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function GET() {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  return NextResponse.json({ events: [], blockedTrades: [] })
}
