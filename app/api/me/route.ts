import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const res = NextResponse.json({
    id:    session.id,
    email: session.email,
    name:  session.name,
  })

  // Cache for 5 minutes — user identity never changes mid-session
  res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=60')
  return res
}
