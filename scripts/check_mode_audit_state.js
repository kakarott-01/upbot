require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
  try {
    const mode = await sql`SELECT to_regclass('public.mode_audit_logs') AS reg`
    const journal = await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT 20`
    console.log('MODE_REG:', JSON.stringify(mode[0] || null))
    console.log('JOURNAL_ROWS:', JSON.stringify(journal || []))
  } finally {
    await sql.end()
  }
})().catch(err => { console.error(err); process.exit(1) })
