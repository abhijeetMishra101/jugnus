-- 007_deploy_url — store the preview URL generated when a project completes

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deploy_url text;
