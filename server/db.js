import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contributors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  expertise TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expertise_required TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'draft',
  current_assignment_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS routing_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  generation INTEGER NOT NULL,
  scenario TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  eligible TEXT NOT NULL,
  chosen_contributor_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  contributor_id TEXT NOT NULL REFERENCES contributors(id),
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_task ON routing_attempts(task_id);
CREATE INDEX IF NOT EXISTS idx_assignments_task ON assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_assignment ON assignments(task_id) WHERE status = 'proposed';
`;

export function openDb(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function insertEvent(db, taskId, type, detail = {}) {
  db.prepare('INSERT INTO events (task_id, type, detail, created_at) VALUES (?, ?, ?, ?)')
    .run(taskId, type, JSON.stringify(detail), new Date().toISOString());
}
