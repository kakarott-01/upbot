require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

;(async () => {
  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })
    const id = process.argv[2]
    if (!id) {
      console.error('Usage: node delete_mode_audit.js <id>')
      process.exit(2)
    }

    await sql`DELETE FROM mode_audit_logs WHERE id = ${id}`
    console.log('DELETED', id)
    await sql.end()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
