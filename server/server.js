import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';
import { createService } from './service.js';
import { createApp } from './app.js';
import { seedIfEmpty } from './seed.js';
import { createBullScheduler } from './schedulers.js';
import { createCache } from './cache.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = openDb(path.join(dataDir, 'terac.sqlite'));
const seeded = seedIfEmpty(db);
const redisUrl = process.env.REDIS_URL || null;
const service = createService(db, redisUrl ? { scheduler: createBullScheduler(redisUrl) } : {});
const sweep = await service.sweepInterrupted();
const cache = createCache(redisUrl);
const app = createApp(service, cache);

const dist = path.join(root, 'client', 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  console.log('UI build not found — serving API only. Build it with: npm --prefix client install && npm run build');
}

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`Terac task router listening on http://localhost:${port}`);
  if (seeded) console.log(`Seeded ${seeded.contributors} contributors and ${seeded.tasks} tasks.`);
  if (sweep.interruptedAttempts > 0) {
    console.log(`Restart sweep: reopened ${sweep.tasksReopened} task(s) from ${sweep.interruptedAttempts} interrupted routing attempt(s).`);
  }
});

async function shutdown() {
  await service.shutdown().catch(() => {});
  await cache.close().catch(() => {});
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
