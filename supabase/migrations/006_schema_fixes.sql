-- 006_schema_fixes — fix CHECK constraint gaps found during live test

-- 1. Add 'failed' to tasks.status so the watchdog can mark tasks terminal
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed'));

-- 2. Add 'activity' to messages.author_type so thinking/progress indicators can be stored
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_author_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_author_type_check
  CHECK (author_type IN ('user', 'jugnu', 'system', 'activity'));

-- 3. Ensure retry_count column exists (was added directly to live DB — now in migration)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
