import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardErrorResponse, requireAccess } from '@/lib/guards'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  // Fetch user row to expose createdAt to the client
  const userRow = await db.query.users.findFirst({
    where: eq(users.id, session.id),
    columns: { createdAt: true },
  })

  const res = NextResponse.json({
    id:    session.id,
    email: session.email,
    name:  session.name,
    createdAt: userRow?.createdAt ? userRow.createdAt.toISOString() : null,
  })

  // Cache for 5 minutes — user identity never changes mid-session
  res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=60')
  return res
}
