require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const userId = 'fd0f9174-1c26-46a9-a25d-ac14bf5c5f1f'

    const totalRows = await sql`SELECT count(*)::int AS count FROM trades WHERE user_id = ${userId} AND status = 'open'`
    console.log('TOTAL', totalRows[0]?.count ?? 0)

    const perMarket = await sql`SELECT market_type, count(*)::int AS count FROM trades WHERE user_id = ${userId} AND status = 'open' GROUP BY market_type`
    console.log('PER_MARKET', perMarket)

    await sql.end()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
