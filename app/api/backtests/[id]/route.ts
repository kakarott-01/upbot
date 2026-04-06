import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { backtestRuns, backtestResults, strategyConfigs } from '@/lib/schema'
import { and, eq } from 'drizzle-orm'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const run = await db.query.backtestRuns.findFirst({
    where: and(
      eq(backtestRuns.id, params.id),
      eq(backtestRuns.userId, session.id),
    ),
  })

  if (!run) return NextResponse.json({ error: 'Backtest not found.' }, { status: 404 })
  return NextResponse.json(run)
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const run = await db.query.backtestRuns.findFirst({
    where: and(
      eq(backtestRuns.id, params.id),
      eq(backtestRuns.userId, session.id),
    ),
    columns: { id: true, strategyConfigId: true },
  })

  if (!run) return NextResponse.json({ error: 'Backtest not found.' }, { status: 404 })

  // Delete associated results first (FK constraint), then the run itself
  await db.delete(backtestResults).where(eq(backtestResults.runId, run.id))
  await db.delete(backtestRuns).where(and(
    eq(backtestRuns.id, run.id),
    eq(backtestRuns.userId, session.id),
  ))

  // Clean up orphaned strategy config snapshot if present
  if (run.strategyConfigId) {
    const remaining = await db.query.backtestRuns.findFirst({
      where: eq(backtestRuns.strategyConfigId, run.strategyConfigId),
      columns: { id: true },
    })
    if (!remaining) {
      await db.delete(strategyConfigs).where(eq(strategyConfigs.id, run.strategyConfigId))
    }
  }

  return NextResponse.json({ success: true })
}