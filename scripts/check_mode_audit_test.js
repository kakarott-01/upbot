require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const rows = await sql`SELECT count(*)::int AS count FROM mode_audit_logs WHERE scope = 'test-mode-audit-retention'`
    console.log('REMAINING', rows[0]?.count ?? 0)
    await sql.end()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
