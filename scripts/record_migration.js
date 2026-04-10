#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const crypto = require('crypto');
const sql = require('postgres')(process.env.DATABASE_URL, { ssl: 'require' });

(async () => {
  try {
    const migration = fs.readFileSync('drizzle/migrations/0010_exchange_apis_user_market_uq.sql', 'utf8');
    const hash = crypto.createHash('sha256').update(migration).digest('hex');
    const exists = await sql`SELECT count(*) AS c FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`;
    if (exists[0].c > 0) {
      console.log('Migration record already present:', hash);
    } else {
      await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
      console.log('Inserted migration record:', hash);
    }
    await sql.end();
  } catch (err) {
    console.error(err);
    await sql.end();
    process.exit(1);
  }
})();
