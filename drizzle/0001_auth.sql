CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  auth_version TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE auth_login_limits (
  key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
