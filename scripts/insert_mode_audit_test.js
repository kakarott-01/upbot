require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const userId = process.argv[2] || 'fd0f9174-1c26-46a9-a25d-ac14bf5c5f1f'
    const createdAt = process.argv[3] || '2000-01-01T00:00:00Z'

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
