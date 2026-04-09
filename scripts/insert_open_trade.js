require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const userId = process.argv[2] || 'fd0f9174-1c26-46a9-a25d-ac14bf5c5f1f'
    const market = process.argv[3] || 'crypto'
    const symbol = process.argv[4] || 'TESTBTC'
    const side = process.argv[5] || 'buy'
    const quantity = process.argv[6] || '1'
    const entryPrice = process.argv[7] || '1000'

    const res = await sql`
      INSERT INTO trades (user_id, exchange_name, market_type, symbol, side, quantity, entry_price, status, is_paper, opened_at)
      VALUES (${userId}, 'test-ex', ${market}, ${symbol}, ${side}, ${quantity}, ${entryPrice}, 'open', true, now())
      RETURNING id
    `

    console.log('INSERTED', res[0])
    await sql.end()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
