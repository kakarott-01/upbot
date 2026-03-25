import {
  pgTable, text, timestamp, boolean, integer,
  decimal, jsonb, uuid, varchar, index, pgEnum
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Enums ────────────────────────────────────────────────────────────────────
export const marketTypeEnum = pgEnum('market_type', [
  'indian', 'crypto', 'commodities', 'global'
])

export const tradeSideEnum = pgEnum('trade_side', ['buy', 'sell'])

export const tradeStatusEnum = pgEnum('trade_status', [
  'pending', 'open', 'closed', 'cancelled', 'failed'
])

export const botStatusEnum = pgEnum('bot_status_enum', [
  'running', 'stopped', 'paused', 'error'
])

export const signalEnum = pgEnum('signal_type', ['buy', 'sell', 'hold'])

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id:            uuid('id').defaultRandom().primaryKey(),
  email:         varchar('email', { length: 255 }).notNull().unique(),
  name:          varchar('name', { length: 255 }),
  googleId:      varchar('google_id', { length: 255 }).unique(),
  avatarUrl:     text('avatar_url'),
  isActive:      boolean('is_active').default(true).notNull(),
  isWhitelisted: boolean('is_whitelisted').default(false).notNull(),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  lastLoginAt:   timestamp('last_login_at'),
}, (t) => ({
  emailIdx: index('users_email_idx').on(t.email),
}))

// ─── Access Codes ─────────────────────────────────────────────────────────────
export const accessCodes = pgTable('access_codes', {
  id:          uuid('id').defaultRandom().primaryKey(),
  code:        varchar('code', { length: 64 }).notNull().unique(), // stored as bcrypt hash
  label:       varchar('label', { length: 100 }),                  // e.g. "For Rahul"
  createdBy:   varchar('created_by', { length: 255 }).notNull(),   // admin email
  expiresAt:   timestamp('expires_at').notNull(),
  isBurned:    boolean('is_burned').default(false).notNull(),
  burnedAt:    timestamp('burned_at'),
  burnedByIp:  varchar('burned_by_ip', { length: 64 }),
  usedByEmail: varchar('used_by_email', { length: 255 }),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
})

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const sessions = pgTable('sessions', {
  id:                uuid('id').defaultRandom().primaryKey(),
  userId:            uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash:         varchar('token_hash', { length: 255 }).notNull(), // hashed JWT
  deviceFingerprint: text('device_fingerprint'),
  ipAddress:         varchar('ip_address', { length: 64 }),
  userAgent:         text('user_agent'),
  isActive:          boolean('is_active').default(true).notNull(),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
  lastSeenAt:        timestamp('last_seen_at').defaultNow().notNull(),
  revokedAt:         timestamp('revoked_at'),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId),
}))

// ─── Market Configs ───────────────────────────────────────────────────────────
export const marketConfigs = pgTable('market_configs', {
  id:         uuid('id').defaultRandom().primaryKey(),
  userId:     uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  marketType: marketTypeEnum('market_type').notNull(),
  isActive:   boolean('is_active').default(true).notNull(),
  algoName:   varchar('algo_name', { length: 100 }),          // which algo to use
  paperMode:  boolean('paper_mode').default(true).notNull(),  // always start paper
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userMarketIdx: index('market_configs_user_market_idx').on(t.userId, t.marketType),
}))

// ─── Exchange APIs ─────────────────────────────────────────────────────────────
export const exchangeApis = pgTable('exchange_apis', {
  id:            uuid('id').defaultRandom().primaryKey(),
  userId:        uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  marketType:    marketTypeEnum('market_type').notNull(),
  exchangeName:  varchar('exchange_name', { length: 100 }).notNull(), // e.g. "zerodha", "coindcx"
  exchangeLabel: varchar('exchange_label', { length: 100 }),
  apiKeyEnc:     text('api_key_enc').notNull(),     // AES-256 encrypted
  apiSecretEnc:  text('api_secret_enc').notNull(),  // AES-256 encrypted
  extraFieldsEnc:text('extra_fields_enc'),           // JSON of extra fields, encrypted
  isVerified:    boolean('is_verified').default(false).notNull(),
  isActive:      boolean('is_active').default(true).notNull(),
  lastVerifiedAt:timestamp('last_verified_at'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userExchangeIdx: index('exchange_apis_user_idx').on(t.userId, t.marketType),
}))

// ─── Bot Status ───────────────────────────────────────────────────────────────
export const botStatuses = pgTable('bot_statuses', {
  id:            uuid('id').defaultRandom().primaryKey(),
  userId:        uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  status:        botStatusEnum('status').default('stopped').notNull(),
  activeMarkets: jsonb('active_markets').$type<string[]>().default([]),
  startedAt:     timestamp('started_at'),
  stoppedAt:     timestamp('stopped_at'),
  lastHeartbeat: timestamp('last_heartbeat'),
  lastSignal:    text('last_signal'),
  errorMessage:  text('error_message'),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
})

// ─── Risk Settings ────────────────────────────────────────────────────────────
export const riskSettings = pgTable('risk_settings', {
  id:               uuid('id').defaultRandom().primaryKey(),
  userId:           uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  maxPositionPct:   decimal('max_position_pct', { precision: 5, scale: 2 }).default('2.00').notNull(),
  stopLossPct:      decimal('stop_loss_pct',    { precision: 5, scale: 2 }).default('1.50').notNull(),
  takeProfitPct:    decimal('take_profit_pct',  { precision: 5, scale: 2 }).default('3.00').notNull(),
  maxDailyLossPct:  decimal('max_daily_loss_pct',{ precision: 5, scale: 2 }).default('5.00').notNull(),
  maxOpenTrades:    integer('max_open_trades').default(3).notNull(),
  cooldownSeconds:  integer('cooldown_seconds').default(300).notNull(),
  trailingStop:     boolean('trailing_stop').default(false).notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
})

// ─── Trades ───────────────────────────────────────────────────────────────────
export const trades = pgTable('trades', {
  id:              uuid('id').defaultRandom().primaryKey(),
  userId:          uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  exchangeName:    varchar('exchange_name', { length: 100 }).notNull(),
  marketType:      marketTypeEnum('market_type').notNull(),
  symbol:          varchar('symbol', { length: 50 }).notNull(),   // e.g. BTC/USDT
  side:            tradeSideEnum('side').notNull(),
  quantity:        decimal('quantity',   { precision: 20, scale: 8 }).notNull(),
  entryPrice:      decimal('entry_price',{ precision: 20, scale: 8 }).notNull(),
  exitPrice:       decimal('exit_price', { precision: 20, scale: 8 }),
  stopLoss:        decimal('stop_loss',  { precision: 20, scale: 8 }),
  takeProfit:      decimal('take_profit',{ precision: 20, scale: 8 }),
  pnl:             decimal('pnl',        { precision: 20, scale: 8 }),
  pnlPct:          decimal('pnl_pct',    { precision: 8,  scale: 4 }),
  status:          tradeStatusEnum('status').default('pending').notNull(),
  algoUsed:        varchar('algo_used', { length: 100 }),
  signalId:        uuid('signal_id'),
  isPaper:         boolean('is_paper').default(true).notNull(),
  exchangeOrderId: varchar('exchange_order_id', { length: 255 }),
  openedAt:        timestamp('opened_at').defaultNow().notNull(),
  closedAt:        timestamp('closed_at'),
  metadata:        jsonb('metadata'),                              // raw exchange response
}, (t) => ({
  userIdx:    index('trades_user_idx').on(t.userId),
  symbolIdx:  index('trades_symbol_idx').on(t.symbol),
  statusIdx:  index('trades_status_idx').on(t.status),
  openedIdx:  index('trades_opened_idx').on(t.openedAt),
}))

// ─── Algo Signals ─────────────────────────────────────────────────────────────
export const algoSignals = pgTable('algo_signals', {
  id:                 uuid('id').defaultRandom().primaryKey(),
  userId:             uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  marketType:         marketTypeEnum('market_type').notNull(),
  symbol:             varchar('symbol', { length: 50 }).notNull(),
  signal:             signalEnum('signal').notNull(),
  confidence:         decimal('confidence', { precision: 5, scale: 2 }), // 0-100
  algoName:           varchar('algo_name', { length: 100 }),
  timeframe:          varchar('timeframe', { length: 20 }),
  indicatorsSnapshot: jsonb('indicators_snapshot'),  // RSI=28, EMA9=43200, etc.
  wasExecuted:        boolean('was_executed').default(false).notNull(),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx:    index('signals_user_idx').on(t.userId),
  createdIdx: index('signals_created_idx').on(t.createdAt),
}))

// ─── Relations ────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many, one }) => ({
  sessions:      many(sessions),
  marketConfigs: many(marketConfigs),
  exchangeApis:  many(exchangeApis),
  trades:        many(trades),
  algoSignals:   many(algoSignals),
  botStatus:     one(botStatuses, { fields: [users.id], references: [botStatuses.userId] }),
  riskSettings:  one(riskSettings, { fields: [users.id], references: [riskSettings.userId] }),
}))

export const tradesRelations = relations(trades, ({ one }) => ({
  user: one(users, { fields: [trades.userId], references: [users.id] }),
}))

// ─── Types (inferred) ─────────────────────────────────────────────────────────
export type User           = typeof users.$inferSelect
export type NewUser        = typeof users.$inferInsert
export type AccessCode     = typeof accessCodes.$inferSelect
export type Session        = typeof sessions.$inferSelect
export type MarketConfig   = typeof marketConfigs.$inferSelect
export type ExchangeApi    = typeof exchangeApis.$inferSelect
export type Trade          = typeof trades.$inferSelect
export type NewTrade       = typeof trades.$inferInsert
export type AlgoSignal     = typeof algoSignals.$inferSelect
export type BotStatus      = typeof botStatuses.$inferSelect
export type RiskSettings   = typeof riskSettings.$inferSelect