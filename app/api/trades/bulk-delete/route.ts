// app/api/trades/bulk-delete/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

const schema = z.object({
  type: z.enum(['all', 'paper', 'live', 'selected']).optional(),
  ids:  z.array(z.string().uuid()).optional(),
})

export async function DELETE(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { type, ids } = parsed.data

  if (type === 'selected') {
    if (!ids || ids.length === 0) return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
    await db.delete(trades).where(and(
      eq(trades.userId, session.id),
      inArray(trades.id, ids),
    ))
    return NextResponse.json({ success: true, deleted: ids.length })
  }

  if (type === 'all') {
    const result = await db.delete(trades).where(eq(trades.userId, session.id)).returning({ id: trades.id })
    return NextResponse.json({ success: true, deleted: result.length })
  }

  if (type === 'paper') {
    const result = await db.delete(trades).where(and(
      eq(trades.userId, session.id),
      eq(trades.isPaper, true),
    )).returning({ id: trades.id })
    return NextResponse.json({ success: true, deleted: result.length })
  }

  if (type === 'live') {
    const result = await db.delete(trades).where(and(
      eq(trades.userId, session.id),
      eq(trades.isPaper, false),
    )).returning({ id: trades.id })
    return NextResponse.json({ success: true, deleted: result.length })
  }

  return NextResponse.json({ error: 'Specify type or ids' }, { status: 400 })
}
