-- 012_boldo_tables — multi-device households for the BolDo demo app
-- Households are isolated by household_id; no auth required (anon key, open RLS)

CREATE TABLE IF NOT EXISTS boldo_households (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  join_code   text UNIQUE NOT NULL,
  city        text,
  owner_name  text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boldo_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid REFERENCES boldo_households(id) ON DELETE CASCADE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner', 'family', 'househelp')),
  device_id     text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(household_id, device_id)
);

CREATE TABLE IF NOT EXISTS boldo_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid REFERENCES boldo_households(id) ON DELETE CASCADE,
  item_name     text NOT NULL,
  item_emoji    text,
  item_category text,
  status        text NOT NULL CHECK (status IN ('urgent', 'finished', 'low')),
  notes         text,
  reporter_name text NOT NULL,
  reporter_role text NOT NULL,
  resolved      boolean DEFAULT false,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE boldo_households ENABLE ROW LEVEL SECURITY;
ALTER TABLE boldo_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE boldo_items      ENABLE ROW LEVEL SECURITY;

-- Open policies — isolation comes from household_id, not user auth
CREATE POLICY "boldo_households_open" ON boldo_households FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "boldo_members_open"    ON boldo_members    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "boldo_items_open"      ON boldo_items      FOR ALL USING (true) WITH CHECK (true);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS boldo_items_household_idx       ON boldo_items    (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS boldo_members_household_idx     ON boldo_members  (household_id);
CREATE INDEX IF NOT EXISTS boldo_households_join_code_idx  ON boldo_households (lower(join_code));
