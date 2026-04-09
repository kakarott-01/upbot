require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
  try {
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`
    console.log('DROPPED_DRIZZLE_SCHEMA')
  } finally {
    await sql.end()
  }
})().catch(err => { console.error(err); process.exit(1) })
