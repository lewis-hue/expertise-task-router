# Submission notes

The public repository is at
https://github.com/lewis-hue/expertise-task-router. It uses a generic project
name. The local development-session export is excluded from the repository.

```text
Repository: https://github.com/lewis-hue/expertise-task-router
Walkthrough video: <Loom link, 10 minutes max — still to record>

Agent setup:
One continuous project-specific Muse Code CLI session (no subagents).
Plan-first turn, then incremental implementation with a committed node:test
suite; research via official docs (Node, Express, SQLite, React, Vite,
BullMQ, Docker Hub tag API).

Session map:
- Initial planning or decomposition: the session's plan turn — "generate a
  plan" reply with Goal/Success Criteria/Approach/Steps/Validation/Risks,
  approved with "go".
- Most important correction or change of direction: the Celery/Redis/Docker
  steer mid-build — rejected both Python shapes after two clarification
  rounds and rebuilt on BullMQ + Redis + Docker (Node kept, timers replaced
  with delayed queue jobs, cache + compose added).
- Final testing and verification: 18/18 fast suite, 2/2 live Redis/BullMQ
  tests, Vite production build, Docker Compose build, and live API drills for
  routing, intervention, recovery, concurrency, and restart behavior.

Intentional omissions:
- Auth/multi-user: single-operator exercise; contributor responses are
  explicit operator-recorded actions.
- Postgres: SQLite on a shared volume matches the scale; busy_timeout covers
  the api+worker pair.
- Celery/Python worker: considered, rejected — user ruled out both Python
  shapes; BullMQ is the Node-native equivalent on the same Redis.
- Browser automation and load testing: not performed. The UI assets and API
  were checked over HTTP, and the Docker stack remains available for manual
  browser testing at http://localhost:3000.
- Production hardening (TLS, secrets management, migrations, CI): out of
  scope for a local exercise.
```
