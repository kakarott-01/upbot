import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const now = new Date()

  return NextResponse.json(
    {
      server_time: now.toISOString(),
      server_now_ms: now.getTime(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  )
}
