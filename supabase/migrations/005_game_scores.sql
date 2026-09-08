-- 005_game_scores — leaderboard for Flappy Jugnu mini-game

CREATE TABLE IF NOT EXISTS game_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  workspace_id uuid,
  project_id uuid REFERENCES projects(id),
  score integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS game_scores_user_idx ON game_scores(user_id, score DESC);
CREATE INDEX IF NOT EXISTS game_scores_created_at_idx ON game_scores(created_at DESC);

ALTER TABLE game_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert scores" ON game_scores FOR INSERT WITH CHECK (true);
CREATE POLICY "Scores are publicly readable" ON game_scores FOR SELECT USING (true);
