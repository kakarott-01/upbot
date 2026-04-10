-- Migration: add UNIQUE(user_id, market_type) to exchange_apis
-- 1) Deduplicate existing rows (keep most-recently-updated)
-- 2) Add a UNIQUE constraint to prevent future duplicates

-- Step 1: remove duplicates, keeping the most recently updated row per (user_id, market_type)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id, market_type ORDER BY COALESCE(updated_at, created_at) DESC, id) AS rn
  FROM exchange_apis
)
DELETE FROM exchange_apis e
USING ranked r
WHERE e.id = r.id
  AND r.rn > 1;

-- Step 2: add the unique constraint
ALTER TABLE exchange_apis
  ADD CONSTRAINT exchange_apis_user_market_uq UNIQUE (user_id, market_type);
