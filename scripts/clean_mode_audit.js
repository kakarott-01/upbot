require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

const args = process.argv.slice(2)
const run = args.includes('--run')
const daysArg = args.find(a => a.startsWith('--days='))
const envDays = process.env.MODE_AUDIT_RETENTION_DAYS
const retentionDays = Number((daysArg ? daysArg.split('=')[1] : (envDays || '90')))

if (Number.isNaN(retentionDays) || retentionDays <= 0) {
  console.error('Invalid retentionDays; must be a positive integer')
  process.exit(2)
}

const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })

    const before = (await sql`SELECT count(*)::int AS count FROM mode_audit_logs WHERE created_at < ${cutoff}`)[0]?.count ?? 0
    console.log(`Retention days: ${retentionDays}`)
    console.log(`Cutoff (ISO): ${cutoff}`)
    console.log(`Rows older than cutoff: ${before}`)

    if (before === 0) {
      await sql.end()
      process.exit(0)
    }

    const sample = await sql`SELECT id, user_id, scope, from_mode, to_mode, ip_address, user_agent, created_at
      FROM mode_audit_logs
      WHERE created_at < ${cutoff}
      ORDER BY created_at ASC
      LIMIT 20`

    console.log('Sample rows (up to 20):')
    for (const r of sample) {
      console.log(`${r.id} | user=${r.user_id} | scope=${r.scope} | from=${r.from_mode} -> to=${r.to_mode} | created=${r.created_at}`)
    }

    if (!run) {
      console.log('\nDry-run: no rows were deleted. To actually delete, run with --run')
      await sql.end()
      process.exit(0)
    }

    // Perform deletion
    await sql.begin(async sql => {
      await sql`DELETE FROM mode_audit_logs WHERE created_at < ${cutoff}`
    })

    const after = (await sql`SELECT count(*)::int AS count FROM mode_audit_logs WHERE created_at < ${cutoff}`)[0]?.count ?? 0
    console.log(`Deleted ${before - after} rows older than cutoff`)

    await sql.end()
    process.exit(0)
  } catch (err) {
    console.error('Error running retention:', err)
    process.exit(1)
  }
})()
