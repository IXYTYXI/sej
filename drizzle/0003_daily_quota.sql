CREATE TABLE daily_quotas (
  user_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en','ja')),
  day TEXT NOT NULL,
  base_limit INTEGER NOT NULL CHECK (typeof(base_limit)='integer' AND base_limit BETWEEN 5 AND 50),
  quota_limit INTEGER NOT NULL CHECK (typeof(quota_limit)='integer' AND quota_limit BETWEEN base_limit AND 2147483647),
  boosts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(boosts) AND json_type(boosts)='array' AND json_array_length(boosts)<=3),
  decision TEXT NOT NULL CHECK (decision IN ('none','pending','keep','reset')),
  previous_day TEXT,
  previous_limit INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
  last_request TEXT NOT NULL,
  before_state TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id,language,day)
);
--> statement-breakpoint
CREATE TABLE quota_events (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en','ja')),
  day TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('initialize','settings','boost','keep','reset')),
  amount INTEGER,
  fingerprint TEXT NOT NULL,
  before_state TEXT,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id,request_id)
);
--> statement-breakpoint
CREATE INDEX quota_events_user_day ON quota_events (user_id,language,day);
