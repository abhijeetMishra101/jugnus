-- Outcome store: captures what went wrong (and right) per jugnu across projects.
-- Learning injection reads from this table at dispatch time and appends relevant
-- lessons to each jugnu's context block so mistakes don't repeat across projects.

CREATE TABLE IF NOT EXISTS jugnu_learnings (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  jugnu_key     text        NOT NULL,                -- who this learning applies to
  source_project_id uuid,                            -- which project generated it
  learning_type text        NOT NULL                 -- 'mistake' | 'pattern' | 'fix'
                CHECK (learning_type IN ('mistake', 'pattern', 'fix')),
  content       text        NOT NULL,                -- concise actionable lesson
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jugnu_learnings_jugnu_key_idx
  ON jugnu_learnings (jugnu_key, created_at DESC);

-- Allow service role full access
ALTER TABLE jugnu_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON jugnu_learnings
  USING (true) WITH CHECK (true);

-- Shared constitutional principles — injected into every jugnu's context block.
-- Edit rows here to change agent behavior without code changes or redeployment.
CREATE TABLE IF NOT EXISTS jugnu_principles (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  content    text        NOT NULL,
  active     boolean     DEFAULT true,
  priority   int         DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jugnu_principles_active_idx ON jugnu_principles (active, priority DESC);
ALTER TABLE jugnu_principles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON jugnu_principles USING (true) WITH CHECK (true);
