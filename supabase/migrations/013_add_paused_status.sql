-- Add 'paused' to the projects status enum so the pause pipeline feature works.
-- The original constraint in 001_initial.sql did not include this value.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('active', 'planning', 'building', 'reviewing', 'completed', 'blocked', 'cancelled', 'paused'));
