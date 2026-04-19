import { drizzle } from 'drizzle-orm/neon-serverless'
import { Pool, neonConfig } from '@neondatabase/serverless'
import * as schema from './schema'

// Next's server bundling can surface incompatible optional ws native helpers.
// Force the library to use its built-in JS fallback so Neon sockets stay stable.
process.env.WS_NO_BUFFER_UTIL ??= '1'
process.env.WS_NO_UTF_8_VALIDATE ??= '1'

const ws = require('ws') as typeof import('ws')

neonConfig.webSocketConstructor = ws

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle(pool, { schema })
export type DB = typeof db
