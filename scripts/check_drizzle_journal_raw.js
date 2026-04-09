require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
  try {
    const rows = await sql`SELECT * FROM drizzle.__drizzle_migrations LIMIT 20`
    console.log(JSON.stringify(rows, null, 2))
  } finally {
    await sql.end()
  }
})().catch(err => { console.error(err); process.exit(1) })
