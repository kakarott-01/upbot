require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const userId = process.argv[2]
    if (!userId) {
      console.error('Usage: node delete_bot_status.js <userId>')
      process.exit(2)
    }

    await sql`DELETE FROM bot_statuses WHERE user_id = ${userId}`
    console.log('DELETED bot_statuses for', userId)
    await sql.end()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
