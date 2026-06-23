PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_game_sessions (
  session_id TEXT PRIMARY KEY,
  submission_token_hash TEXT NOT NULL UNIQUE,
  user_uid TEXT NOT NULL,
  difficulty TEXT NOT NULL
    CHECK (difficulty IN ('easy', 'normal', 'hard', 'superhard', 'extreme', 'hell', 'chaos')),
  mode TEXT NOT NULL
    CHECK (mode IN ('speed', 'item')),
  ghost_mode INTEGER NOT NULL DEFAULT 0
    CHECK (ghost_mode IN (0, 1)),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  submitted_at INTEGER,
  FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_game_sessions_user_index
  ON ai_game_sessions (user_uid, started_at DESC);

CREATE INDEX IF NOT EXISTS ai_game_sessions_expiry_index
  ON ai_game_sessions (expires_at);

CREATE TABLE IF NOT EXISTS ai_rank_submissions (
  submission_id TEXT PRIMARY KEY,
  game_session_id TEXT NOT NULL UNIQUE,
  user_uid TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  mode TEXT NOT NULL,
  ghost_mode INTEGER NOT NULL
    CHECK (ghost_mode IN (0, 1)),
  clear_time_ms INTEGER NOT NULL
    CHECK (clear_time_ms BETWEEN 1000 AND 21600000),
  territory_basis_points INTEGER NOT NULL
    CHECK (territory_basis_points BETWEEN 0 AND 10000),
  submitted_at INTEGER NOT NULL,
  FOREIGN KEY (game_session_id) REFERENCES ai_game_sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_rank_submissions_user_index
  ON ai_rank_submissions (user_uid, difficulty, mode, submitted_at DESC);

CREATE TABLE IF NOT EXISTS ai_best_records (
  user_uid TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  mode TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  clear_time_ms INTEGER NOT NULL,
  territory_basis_points INTEGER NOT NULL,
  ghost_mode INTEGER NOT NULL
    CHECK (ghost_mode IN (0, 1)),
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (user_uid, difficulty, mode),
  FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE,
  FOREIGN KEY (submission_id) REFERENCES ai_rank_submissions(submission_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_best_records_ranking_index
  ON ai_best_records (
    difficulty,
    mode,
    clear_time_ms ASC,
    territory_basis_points DESC,
    achieved_at ASC,
    user_uid ASC
  );
