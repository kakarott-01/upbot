import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botStatuses } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await auth()

  // ✅ FIXED
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const status = await db.query.botStatuses.findFirst({
    where: eq(botStatuses.userId, session.id),
  })

  if (!status) {
    return NextResponse.json({
      status: 'stopped',
      activeMarkets: [],
      startedAt: null,
      lastHeartbeat: null,
      errorMessage: null,
    })
  }

  return NextResponse.json({
    status: status.status,
    activeMarkets: status.activeMarkets ?? [],
    startedAt: status.startedAt,
    lastHeartbeat: status.lastHeartbeat,
    errorMessage: status.errorMessage,
  })
}