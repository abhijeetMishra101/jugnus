-- 004_telemetry — per-task model usage tracking + per-project cost ceiling

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS input_tokens integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cached_tokens integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_calls integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(10,6) DEFAULT 0;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS total_cost_usd numeric(10,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_ceiling_usd numeric(10,2);
