# Terac Task Router

Operator console plus simulated routing engine for assigning tasks to contributors
by expertise. Submit a task and a background worker pool routes it; the operator
watches, intervenes any time, and recovers work that fails or is declined.

## Quickstart (Docker)

```powershell
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

This starts three services: `api` (Express + serves the UI), `worker`
(BullMQ routing workers, concurrency 4), and `redis` (queue broker, result
backend, and read cache). SQLite lives on a shared named volume; Redis
persists with append-only mode.

Scale the worker pool to watch concurrency change:

```powershell
docker compose up --scale worker=2
```

## Bare-metal development

```powershell
npm install
npm --prefix client install
npm run build
npm start
```

Without `REDIS_URL` the API uses the in-process scheduler and no cache, so the
app and the fast test suite run with zero infrastructure. Point `REDIS_URL` at
any Redis to use the queue + cache path outside Docker:

```powershell
$env:REDIS_URL = 'redis://127.0.0.1:6379'; npm start
```

Frontend dev server (proxies `/api` to the backend):

```powershell
npm --prefix client run dev
```

## Demo script

1. **Routine assignment.** Pick a task, Submit with `fast-match`, watch it move
   `routing → proposed`, then Record accept. History shows every step.
2. **Unresolved routing.** Submit a high-priority task with `auto` (or `never`).
   Elapsed time grows; past 20s a badge notes it is outside the normal window.
   The UI never claims it is stuck — slow and stuck are indistinguishable.
3. **Human intervention.** While a task routes, Assign manually. The pending
   engine job is superseded; if it returns late it lands in history and never
   overwrites your decision.
4. **Recovery.** Record decline or failure on a proposal, read the timeline,
   then retry routing or assign manually.
5. **Observed concurrency.** Set quick-submit mode to `auto`, submit four tasks
   at once, and watch the Workers strip: delayed/active counts move and worker
   names appear. Compare one worker vs `--scale worker=2`.
6. **Cache.** The header shows the overview `X-Cache` status (`HIT` on repeat
   polls within 5s, `MISS` after any write, `BYPASS` without Redis).

## Decisions

- **BullMQ on Redis instead of Celery.** Celery is Python-native; this stack is
  Node, so the equivalent is BullMQ: delayed jobs replace timers, a worker
  pool with tunable concurrency replaces the in-process engine, and queue
  depth is observable in the UI. Redis stays as broker plus a short-TTL read
  cache with write invalidation.
- **No auto-fail on pending routing.** The brief says slow vs stuck is
  unknowable, so the product never guesses: elapsed time plus a past-window
  flag, and the operator always has Cancel / Retry / Assign.
- **Generation guard, not cancellation.** Every submit bumps a per-task
  generation; only the current generation may write an assignment. Queue
  cancellation is best-effort; the DB guard is authoritative, so late or
  duplicate deliveries become history entries, never overwrites.
- **One active assignee.** Enforced by a partial unique index plus
  transactional supersede on manual override.
- **SQLite on a shared volume** (per choice), with `busy_timeout` for the two
  processes. Restart reopens in-flight routing attempts as actionable history
  and drains their queue jobs.
- **Cache fails open.** Redis errors degrade to `MISS`, never to failed reads.

## Testing

- Fast suite, no infrastructure: `npm test` — 18 tests covering routing
  outcomes, stuck draws, intervention supersede, the stale-generation guard,
  the single-assignee invariant, restart sweep, and HTTP end-to-end through an
  in-process harness (no sockets bound).
- Live queue suite, needs Redis: `test/queue.test.js` skips unless `REDIS_URL`
  is set. With the compose stack up:
  ```powershell
  $env:REDIS_URL = 'redis://127.0.0.1:6379'; npm run test:queue
  ```
  It runs delayed jobs through a real BullMQ worker and verifies cancel
  removes the delayed job.

## Layout

- `server/` — Express app (`app.js`), domain + routing engine (`service.js`),
  schedulers (`schedulers.js`), worker entry (`worker.js`), SQLite schema
  (`db.js`), seed data (`seed.js`), Redis cache (`cache.js`).
- `test/` — node:test suites plus a socket-free HTTP harness.
- `client/` — React operator UI (Vite).
- `Dockerfile`, `docker-compose.yml` — api + worker + redis.
- `SUBMISSION.md` — submission notes. The local development-session export is
  excluded from this public repository.

## Pinned versions and sources

- express 5.3.0, bullmq 6.7.5, ioredis 6.0.0, react 19.3.1, vite 8.3.8
  (see the `package-lock.json` files).
- Images: `node:25-alpine`, `redis:7-alpine3.22` (tags confirmed on Docker Hub).
- Sources: Node docs, Express docs, SQLite docs, React docs, Vite guide,
  BullMQ guide (introduction, connections), Docker Hub tag API.

## Verification status

- Backend suite: 18/18 pass.
- UI production build: passes.
- Live Redis/BullMQ suite: 2/2 pass.
- Docker Compose build and live API drills pass. The drills covered accepted
  routing, a pending request overridden manually, decline/failure recovery,
  no-match, four concurrent routes, a 14-second automatic route, and restart
  recovery. The UI entry point and built JS/CSS assets return HTTP 200.
- The `api`, `worker`, and `redis` containers are running. Open
  [http://localhost:3000](http://localhost:3000) for interactive browser
  checks.
