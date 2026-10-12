CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX users_username ON users(username COLLATE NOCASE);

ALTER TABLE auth_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
