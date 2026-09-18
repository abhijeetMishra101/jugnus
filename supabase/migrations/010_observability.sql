-- 010_observability — extended task telemetry for nextgen architecture
-- Captures routing decisions, execution evidence, and build outcomes per task.

-- routing_decision: which routing path was taken (e.g. SKIP_NIA, PROCEED, ESCALATE_ASTRA)
-- build_evidence: Leo's sandbox execution evidence as JSONB
-- specialists_invoked: which jugnus actually ran for this project (stored on maya's planning task)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS routing_decision   text,
  ADD COLUMN IF NOT EXISTS build_evidence     jsonb,
  ADD COLUMN IF NOT EXISTS specialists_invoked text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS eta               text;

-- tasks table also needs a 'failed' status for Leo sandbox failures
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed'));

-- messages table: add author_type 'activity' if not already allowed
-- (was added as a live patch previously — ensure it's in schema)
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_author_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_author_type_check
    CHECK (author_type IN ('user', 'jugnu', 'system', 'activity'));
