import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/env.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS clusters (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  api_url           TEXT NOT NULL,
  token_enc         TEXT,
  ca_cert           TEXT,
  insecure_skip_tls INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Shared tool connections: one Jenkins / ArgoCD / Prometheus can serve many apps
CREATE TABLE IF NOT EXISTS integrations (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('jenkins','github','argocd','prometheus','grafana','loki')),
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  username    TEXT,
  token_enc   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS apps (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  github_integration_id TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  github_repo           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per app + env. Replicas are NOT stored: they are read live from the cluster / HPA.
CREATE TABLE IF NOT EXISTS environments (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id                    TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL CHECK (name IN ('dev','staging','prod')),
  runtime                   TEXT NOT NULL CHECK (runtime IN ('compose','k8s')),
  deploy_mode               TEXT NOT NULL DEFAULT 'auto' CHECK (deploy_mode IN ('auto','manual')),
  git_branch                TEXT,
  cluster_id                TEXT REFERENCES clusters(id) ON DELETE RESTRICT,
  namespace                 TEXT,
  deployment                TEXT,
  compose_project           TEXT,      -- dev: read via cAdvisor labels in Prometheus
  jenkins_integration_id    TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  jenkins_job               TEXT,
  argocd_integration_id     TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  argocd_app                TEXT,
  prometheus_integration_id TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  prom_selector             TEXT,
  loki_integration_id       TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  loki_selector             TEXT,
  grafana_integration_id    TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  grafana_dashboard_uid     TEXT,
  stress_job                TEXT,      -- Jenkins k6 job
  stress_target_url         TEXT,      -- URL k6 hits
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (app_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT,
  role          TEXT NOT NULL CHECK (role IN ('viewer','operator','admin')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,          -- sha256 of the cookie value; the raw token is never stored
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Who did what (release / rollback / sync / stress ...). Actor comes from auth in phase 5.
CREATE TABLE IF NOT EXISTS activity (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor     TEXT NOT NULL,
  app_id    TEXT,
  env       TEXT,
  action    TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('ok','failed')),
  details   TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_app_env ON activity(app_id, env, id);
`);

// Lightweight migrations for DBs created by earlier phases
function addColumnIfMissing(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumnIfMissing('environments', 'stress_job', 'TEXT');
addColumnIfMissing('environments', 'stress_target_url', 'TEXT');
addColumnIfMissing('integrations', 'insecure_skip_tls', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('integrations', 'ca_cert', 'TEXT');
addColumnIfMissing('integrations', 'tenant_id', 'TEXT');          // X-Scope-OrgID for multi-tenant Loki / Mimir
addColumnIfMissing('environments', 'http_metric', 'TEXT');         // default http_requests_total
addColumnIfMissing('environments', 'http_status_label', 'TEXT');   // default status (promhttp uses "code")
