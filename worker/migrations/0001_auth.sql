PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  nickname TEXT,
  nickname_key TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  CHECK (
    (nickname IS NULL AND nickname_key IS NULL)
    OR
    (nickname IS NOT NULL AND nickname_key IS NOT NULL)
  ),
  CHECK (nickname IS NULL OR length(nickname) BETWEEN 2 AND 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_key_unique
  ON users (nickname_key)
  WHERE nickname_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_status_index
  ON users (status);

CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_user_uid_index
  ON sessions (user_uid);

CREATE INDEX IF NOT EXISTS sessions_expires_at_index
  ON sessions (expires_at);
