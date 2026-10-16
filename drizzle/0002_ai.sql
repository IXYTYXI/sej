CREATE TABLE ai_requests (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  charged INTEGER NOT NULL CHECK (charged IN (0,1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  result TEXT,
  error_status INTEGER,
  error_message TEXT,
  PRIMARY KEY (user_id,request_id)
);
--> statement-breakpoint
CREATE INDEX ai_requests_user_date ON ai_requests (user_id,created_at);
--> statement-breakpoint
CREATE INDEX ai_requests_user_active ON ai_requests (user_id,status,expires_at);
--> statement-breakpoint
CREATE TABLE ai_cache (
  user_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  result TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id,cache_key)
);
--> statement-breakpoint
CREATE INDEX ai_cache_expiry ON ai_cache (expires_at);
