-- 011_project_slug — human-readable preview slug per project
-- Used by /preview/[slug] route so shareable URLs look like:
--   jugnus.vercel.app/preview/boldo
--   jugnus.vercel.app/preview/my-coffee-shop

ALTER TABLE projects ADD COLUMN IF NOT EXISTS preview_slug text UNIQUE;

-- Index for fast slug lookups
CREATE UNIQUE INDEX IF NOT EXISTS projects_preview_slug_idx ON projects (preview_slug)
  WHERE preview_slug IS NOT NULL;

-- Back-fill slugs for any existing completed projects that don't have one
-- (uses a sanitized version of the first word(s) of the title)
UPDATE projects
SET preview_slug = lower(regexp_replace(
  regexp_replace(split_part(title, E'\n', 1), '[^a-zA-Z0-9 ]', '', 'g'),
  ' +', '-', 'g'
))
WHERE preview_slug IS NULL
  AND status = 'completed'
  AND title IS NOT NULL;
