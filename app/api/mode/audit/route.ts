// app/api/mode/audit/route.ts
//
// GET /api/mode/audit  → returns recent mode switch history for the current user

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { modeAuditLogs } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { guardErrorResponse, requireAccess } from '@/lib/guards'
import { boundedIntParam } from '@/lib/api-params'

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const { searchParams } = new URL(req.url)
  const limit = boundedIntParam(searchParams.get('limit'), 20, { min: 1, max: 100 })

  const logs = await db.query.modeAuditLogs.findMany({
    where:   eq(modeAuditLogs.userId, session.id),
    orderBy: [desc(modeAuditLogs.createdAt)],
    limit,
    columns: {
      id:        true,
      scope:     true,
      fromMode:  true,
      toMode:    true,
      ipAddress: true,
      createdAt: true,
      // intentionally omit userAgent for brevity
    },
  })

  return NextResponse.json({ logs })
}
