require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const userId = process.argv[2] || 'fd0f9174-1c26-46a9-a25d-ac14bf5c5f1f'

    await sql`
      INSERT INTO bot_statuses (user_id, status, active_markets, started_at, stopped_at, updated_at)
      VALUES (${userId}, 'stopped', ${[]}, null, null, now())
      ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, active_markets = EXCLUDED.active_markets, updated_at = now()
    `

    console.log('ENSURED bot_statuses for', userId)
    await sql.end()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
