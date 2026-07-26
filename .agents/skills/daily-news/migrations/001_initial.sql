CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  adapter TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_ymd TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX idx_runs_date ON runs (date_ymd);

CREATE TABLE stage_runs (
  run_id INTEGER NOT NULL REFERENCES runs (id),
  stage TEXT NOT NULL CHECK (stage IN ('list', 'article', 'analysis')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  PRIMARY KEY (run_id, stage)
);

CREATE TABLE list_items (
  run_id INTEGER NOT NULL REFERENCES runs (id),
  site_id TEXT NOT NULL REFERENCES sites (id),
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  section TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (run_id, site_id, source_id)
);

CREATE TABLE selections (
  run_id INTEGER NOT NULL,
  site_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  priority INTEGER NOT NULL,
  reason TEXT NOT NULL,
  direction_hint TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, site_id, source_id),
  FOREIGN KEY (run_id, site_id, source_id)
    REFERENCES list_items (run_id, site_id, source_id)
);

-- Content-addressed: identical article text across days is stored once.
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites (id),
  source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  coverage_status TEXT NOT NULL
    CHECK (coverage_status IN ('complete', 'capped', 'partial', 'unknown')),
  coverage_json TEXT NOT NULL DEFAULT '{}',
  content_json TEXT NOT NULL,
  UNIQUE (site_id, source_id, content_hash)
);

-- Per-run reference to a snapshot; keeps run uniqueness independent of content
-- uniqueness so an unchanged re-scrape reuses the row instead of failing.
CREATE TABLE run_articles (
  run_id INTEGER NOT NULL REFERENCES runs (id),
  site_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  article_id INTEGER NOT NULL REFERENCES articles (id),
  linked_at TEXT NOT NULL,
  PRIMARY KEY (run_id, site_id, source_id)
);

CREATE TABLE evidence (
  run_id INTEGER NOT NULL REFERENCES runs (id),
  site_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '[]',
  opinions_json TEXT NOT NULL DEFAULT '[]',
  numbers_json TEXT NOT NULL DEFAULT '[]',
  links_json TEXT NOT NULL DEFAULT '[]',
  validity_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, site_id, source_id)
);

CREATE TABLE report_items (
  run_id INTEGER NOT NULL REFERENCES runs (id),
  site_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  direction_name TEXT NOT NULL,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  blurb TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  validity TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, site_id, source_id)
);

CREATE INDEX idx_report_items_rank ON report_items (run_id, rank);
