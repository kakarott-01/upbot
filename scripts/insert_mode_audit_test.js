require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const userId = process.argv[2] || process.env.TEST_USER_ID
    const createdAt = process.argv[3] || '2000-01-01T00:00:00Z'

    if (!userId) {
      console.error('Usage: node scripts/insert_mode_audit_test.js <userId> [createdAt]\nOr set TEST_USER_ID in your environment')
      process.exit(2)
    }

    const res = await sql`
      INSERT INTO mode_audit_logs (user_id, scope, from_mode, to_mode, ip_address, user_agent, created_at)
      VALUES (${userId}, 'test-mode-audit-retention', 'paper', 'live', '127.0.0.1', 'test-agent', ${createdAt})
      RETURNING id
    `

    console.log('INSERTED', res[0])
    await sql.end()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
