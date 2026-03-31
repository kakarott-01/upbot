import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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